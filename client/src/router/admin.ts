import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import type { RouteLocationNormalized, NavigationGuardNext, RouteRecordRaw } from 'vue-router'
import api from '@/api/admin'

// OAuth 登录码处理状态
let oauthProcessing = false
let oauthProcessed = false
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
    path: '/',
    name: 'admin-root',
    redirect: '/admin/users',
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'nav.users', title: '用户' }
  },
  {
    path: '/login',
    redirect: (to) => ({
      path: '/admin/login',
      query: to.query,
      hash: to.hash
    }),
    meta: { guest: true }
  },
  {
    path: '/admin/login',
    name: 'login',
    component: () => import('@/views/admin/AdminLoginView.vue'),
    meta: { guest: true }
  },
  {
    path: '/admin/users',
    name: 'admin-users',
    component: () => import('@/views/admin/UsersView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'nav.users', title: '用户' }
  },
  {
    path: '/admin/hosting',
    name: 'admin-hosting',
    component: () => import('@/views/admin/HostingView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'nav.hosting', title: '托管' }
  },
  {
    path: '/admin/statistics',
    name: 'admin-statistics',
    component: () => import('@/views/admin/StatisticsView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'nav.statistics', title: '统计' }
  },
  {
    path: '/admin/oauth',
    name: 'admin-oauth',
    component: () => import('@/views/admin/OAuthConfigView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'nav.oauth', title: 'OAuth' }
  },
  {
    path: '/admin/gift-cards',
    name: 'admin-gift-cards',
    component: () => import('@/views/admin/GiftCardsView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'nav.giftCards', title: '礼品卡' }
  },
  {
    path: '/admin/help',
    name: 'admin-help',
    component: () => import('@/views/admin/HelpManageView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'nav.helpManage', title: '帮助' }
  },
  {
    path: '/admin/settings',
    name: 'admin-settings',
    redirect: (to) => ({
      path: '/admin/settings/access',
      query: to.query,
      hash: to.hash
    }),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'nav.settings', title: '设置' }
  },
  {
    path: '/admin/settings/access',
    name: 'admin-settings-access',
    component: () => import('@/views/admin/SystemConfigView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'admin.system.sections.access.title', title: '访问与注册' }
  },
  {
    path: '/admin/settings/hosting',
    name: 'admin-settings-hosting',
    component: () => import('@/views/admin/SystemConfigView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'admin.system.sections.hosting.title', title: '托管与站点' }
  },
  {
    path: '/admin/settings/brand',
    name: 'admin-settings-brand',
    component: () => import('@/views/admin/SystemConfigView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'admin.system.sections.brand.title', title: '品牌与外观' }
  },
  {
    path: '/admin/settings/security',
    name: 'admin-settings-security',
    component: () => import('@/views/admin/SystemConfigView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'admin.system.sections.security.title', title: '安全验证' }
  },
  {
    path: '/admin/settings/mail',
    name: 'admin-settings-mail',
    component: () => import('@/views/admin/SystemConfigView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'admin.system.sections.mail.title', title: '邮件服务' }
  },
  {
    path: '/admin/settings/tickets',
    name: 'admin-settings-tickets',
    component: () => import('@/views/admin/SystemConfigView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'admin.system.sections.tickets.title', title: '工单与附件' }
  },
  {
    path: '/admin/settings/operations',
    name: 'admin-settings-operations',
    component: () => import('@/views/admin/SystemConfigView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'admin.system.sections.operations.title', title: '运营配置' }
  },
  {
    path: '/admin/settings/popup-announcement',
    name: 'admin-settings-popup-announcement',
    component: () => import('@/views/admin/SystemConfigView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'admin.system.popupAnnouncement.title', title: '弹窗公告' }
  },
  {
    path: '/admin/settings/telegram',
    name: 'admin-settings-telegram',
    component: () => import('@/views/admin/TelegramConfigView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'nav.telegramSettings', title: 'Telegram 设置' }
  },
  {
    path: '/admin/system-update',
    name: 'admin-system-update',
    component: () => import('@/views/admin/SystemUpdateView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'nav.systemUpdate', title: '版本更新' }
  },
  {
    path: '/admin/plugins',
    name: 'admin-plugins',
    component: () => import('@/views/admin/PluginCenterView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'nav.plugins', title: '扩展中心' }
  },
  {
    path: '/admin/plugins/:pluginId/settings',
    name: 'admin-plugin-settings',
    component: () => import('@/views/admin/PluginSettingsView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'nav.pluginSettings', title: '扩展设置' }
  },
  {
    path: '/admin/plugins/:pluginId/pages/:pathMatch(.*)*',
    name: 'admin-plugin-page',
    component: () => import('@/views/admin/AdminPluginPageView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'nav.pluginPage', title: '扩展页面' }
  },
  {
    path: '/admin/delivery',
    name: 'admin-delivery',
    component: () => import('@/views/admin/DeliveryCenterView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'nav.delivery', title: '交付保障' }
  },
  {
    path: '/admin/sla-alerts',
    name: 'admin-sla-alerts',
    component: () => import('@/views/admin/SlaAlertsView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'nav.slaAlerts', title: 'SLA 与告警' }
  },
  {
    path: '/admin/resource-risk',
    name: 'admin-resource-risk',
    component: () => import('@/views/admin/ResourceRiskView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'nav.resourceRisk', title: '资源风控' }
  },
  {
    path: '/admin/production-proof',
    name: 'admin-production-proof',
    component: () => import('@/views/admin/ProductionProofView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'nav.productionProof', title: '生产验收' }
  },
  {
    path: '/admin/capacity-cost',
    name: 'admin-capacity-cost',
    component: () => import('@/views/admin/CapacityCostView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'nav.capacityCost', title: '容量与成本' }
  },
  {
    path: '/admin/user-lifecycle',
    name: 'admin-user-lifecycle',
    component: () => import('@/views/admin/UserLifecycleView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'nav.userLifecycle', title: '用户生命周期' }
  },
  {
    path: '/admin/images',
    name: 'admin-images',
    component: () => import('@/views/admin/ImagesView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'nav.images', title: '镜像' }
  },
  {
    path: '/admin/broadcast',
    name: 'admin-broadcast',
    component: () => import('@/views/admin/BroadcastView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'nav.broadcast', title: '公告' }
  },
  {
    path: '/admin/payment-providers',
    name: 'admin-payment-providers',
    redirect: { path: '/admin/billing', query: { tab: 'paymentProviders' } },
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'nav.paymentProviders', title: '支付' }
  },
  {
    path: '/admin/billing',
    name: 'admin-billing',
    component: () => import('@/views/admin/BillingView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'nav.billing', title: '计费' }
  },
  {
    path: '/admin/orders',
    name: 'admin-orders',
    component: () => import('@/views/admin/OrdersView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'nav.orders', title: '订单' }
  },
  {
    path: '/admin/aff',
    name: 'admin-aff',
    redirect: { path: '/admin/billing', query: { tab: 'affConversions' } },
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'nav.aff', title: '推荐' }
  },
  {
    path: '/admin/instances/create',
    name: 'admin-instance-create',
    component: () => import('@/views/admin/AdminInstanceCreateView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'nav.adminCreateInstance', title: '管理员创建实例' }
  },
  {
    path: '/admin/instances',
    name: 'admin-instances',
    component: () => import('@/views/InstancesView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'nav.instances', title: '实例' }
  },
  {
    path: '/admin/instances/:id',
    name: 'admin-instance-detail',
    component: () => import('@/views/InstanceDetailView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'nav.instanceDetail', title: '实例详情' }
  },
  {
    path: '/admin/mail',
    name: 'admin-mail',
    component: () => import('@/views/admin/AdminMailView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'nav.mail', title: '邮箱' }
  },
  {
    path: '/admin/entertainment',
    name: 'admin-entertainment',
    component: () => import('@/views/admin/EntertainmentView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'entertainment.admin.title', title: '娱乐管理' }
  },
  {
    path: '/admin/tickets',
    name: 'admin-tickets',
    component: () => import('@/views/TicketsView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'nav.tickets', title: '工单' }
  },
  {
    path: '/admin/logs',
    name: 'admin-logs',
    component: () => import('@/views/LogsView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'nav.logs', title: '日志' }
  },
  {
    path: '/admin/inbox',
    name: 'admin-inbox',
    component: () => import('@/views/InboxView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'nav.inbox', title: '通知' }
  },
  {
    path: '/admin/profile',
    name: 'admin-profile',
    component: () => import('@/views/ProfileView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'auth.profile', title: '个人设置' }
  },
  {
    path: '/admin/resources/hosts',
    name: 'admin-my-hosts',
    component: () => import('@/views/resources/MyHostsView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'nav.myHosts', title: '节点' }
  },
  {
    path: '/admin/resources/hosts/create',
    name: 'admin-my-host-create',
    component: () => import('@/views/resources/MyHostCreateView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'nav.myHostCreate', title: '创建节点' }
  },
  {
    path: '/admin/resources/hosts/:id',
    name: 'admin-my-host-detail',
    component: () => import('@/views/resources/MyHostDetailView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'nav.myHostDetail', title: '节点详情' }
  },
  {
    path: '/admin/resources/packages',
    name: 'admin-my-packages',
    component: () => import('@/views/resources/MyPackagesView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'nav.myPackages', title: '套餐' }
  },
  {
    path: '/admin/resources/packages/create',
    name: 'admin-my-package-create',
    component: () => import('@/views/resources/PackageFormView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'nav.myPackageCreate', title: '创建套餐' }
  },
  {
    path: '/admin/resources/packages/:id/edit',
    name: 'admin-my-package-edit',
    component: () => import('@/views/resources/PackageFormView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, titleKey: 'nav.myPackageEdit', title: '编辑套餐' }
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
  
  // Pages requiring authentication
  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    next({ name: 'login', query: { redirect: to.fullPath } })
    return
  }

  // Pages requiring admin permission
  if (to.meta.requiresAdmin && !authStore.isAdmin) {
    next({ name: 'login', query: { redirect: to.fullPath } })
    return
  }

  if (authStore.isAuthenticated && !authStore.isAdmin) {
    await authStore.logout()
    next({ name: 'login' })
    return
  }

  // Authenticated admins accessing the admin login page
  if (to.meta.guest && authStore.isAuthenticated) {
    // 根据用户角色跳转
    next({ name: 'admin-users' })
    return
  }

  next()
})

// 预加载常用页面，提升切换速度
router.isReady().then(() => {
  // 延迟预加载，避免影响首屏加载
  setTimeout(() => {
    // 预加载核心页面
    import('@/views/admin/UsersView.vue')
    import('@/views/admin/BillingView.vue')
    import('@/views/admin/OrdersView.vue')
    import('@/views/admin/SystemConfigView.vue')
    import('@/views/admin/HostingView.vue')
  }, 1000)
})

export default router
