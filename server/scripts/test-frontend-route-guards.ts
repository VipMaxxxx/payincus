import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '../..')

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

function sectionBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing end marker after ${startMarker}: ${endMarker}`)
  return source.slice(start, end)
}

function countOccurrences(source: string, needle: string): number {
  return source.split(needle).length - 1
}

const userRouterSource = readRepoFile('client/src/router/user.ts')
const adminRouterSource = readRepoFile('client/src/router/admin.ts')
const appSource = readRepoFile('client/src/App.vue')
const adminAppSource = readRepoFile('client/src/admin/AdminApp.vue')
const authStoreSource = readRepoFile('client/src/stores/auth.ts')
const appLayoutSource = readRepoFile('client/src/components/layout/AppLayout.vue')
const notificationBellSource = readRepoFile('client/src/components/NotificationBell.vue')
const mainSource = readRepoFile('client/src/main.ts')
const adminMainSource = readRepoFile('client/src/admin/main.ts')
const indexHtmlSource = readRepoFile('client/index.html')
const staleAssetRecoverySource = readRepoFile('client/src/utils/staleAssetRecovery.ts')
const turnstileWidgetSource = readRepoFile('client/src/components/TurnstileWidget.vue')
const publicHeaderSource = readRepoFile('client/src/components/public/PublicSiteHeader.vue')
const publicFooterSource = readRepoFile('client/src/components/public/PublicSiteFooter.vue')
const sideNavSource = readRepoFile('client/src/components/layout/SideNav.vue')
const pluginSlotSource = readRepoFile('client/src/components/plugins/PluginSlot.vue')
const pluginFrameSource = readRepoFile('client/src/components/plugins/PluginFrame.vue')
const sideNavUserItemsSource = readRepoFile('client/src/config/side-nav-items-user.ts')
const sideNavAdminItemsSource = readRepoFile('client/src/config/side-nav-items-admin.ts')
const passwordSectionSource = readRepoFile('client/src/components/profile/PasswordSection.vue')
const adminUsersViewSource = readRepoFile('client/src/views/admin/UsersView.vue')
const adminBillingViewSource = readRepoFile('client/src/views/admin/BillingView.vue')
const adminHelpManageViewSource = readRepoFile('client/src/views/admin/HelpManageView.vue')
const adminMailViewSource = readRepoFile('client/src/views/admin/AdminMailView.vue')
const adminImagesViewSource = readRepoFile('client/src/views/admin/ImagesView.vue')
const adminPluginCenterViewSource = readRepoFile('client/src/views/admin/PluginCenterView.vue')
const instancesViewSource = readRepoFile('client/src/views/InstancesView.vue')
const instanceCreateViewSource = readRepoFile('client/src/views/InstanceCreateView.vue')
const instanceDetailViewSource = readRepoFile('client/src/views/InstanceDetailView.vue')
const ticketsViewSource = readRepoFile('client/src/views/TicketsView.vue')
const renewModalSource = readRepoFile('client/src/components/instance/modals/RenewModal.vue')
const changePlanModalSource = readRepoFile('client/src/components/instance/modals/ChangePlanModal.vue')
const initCommandSelectorSource = readRepoFile('client/src/components/extensions/InitCommandSelector.vue')
const hostInstancesTabSource = readRepoFile('client/src/components/host/HostInstancesTab.vue')
const hostCreateInstanceTabSource = readRepoFile('client/src/components/host/HostCreateInstanceTab.vue')
const hostPublicIpv4TabSource = readRepoFile('client/src/components/host/HostPublicIpv4Tab.vue')
const ticketInstanceOwnerCardSource = readRepoFile('client/src/components/tickets/TicketInstanceOwnerCard.vue')
const myHostsViewSource = readRepoFile('client/src/views/resources/MyHostsView.vue')
const myPackagesViewSource = readRepoFile('client/src/views/resources/MyPackagesView.vue')
const instanceLogsTabSource = readRepoFile('client/src/components/instance/InstanceLogsTab.vue')
const configEditModalSource = readRepoFile('client/src/components/instance/modals/ConfigEditModal.vue')
const inboxHelperSource = readRepoFile('client/src/utils/inboxHelper.ts')
const dashboardViewSource = readRepoFile('client/src/views/DashboardView.vue')
const marketViewSource = readRepoFile('client/src/views/MarketView.vue')
const portalViewSource = readRepoFile('client/src/views/PortalView.vue')
const loginViewSource = readRepoFile('client/src/views/LoginView.vue')
const adminLoginViewSource = readRepoFile('client/src/views/admin/AdminLoginView.vue')
const registerViewSource = readRepoFile('client/src/views/RegisterView.vue')
const forgotPasswordViewSource = readRepoFile('client/src/views/ForgotPasswordView.vue')
const helpViewSource = readRepoFile('client/src/views/HelpView.vue')
const oauthAuthorizeViewSource = readRepoFile('client/src/views/OAuthAuthorizeView.vue')
const pluginPageViewSource = readRepoFile('client/src/views/PluginPageView.vue')
const mailViewSource = readRepoFile('client/src/views/MailView.vue')
const mailDomainViewSource = readRepoFile('client/src/views/MailDomainView.vue')
const walletViewSource = readRepoFile('client/src/views/WalletView.vue')
const transfersViewSource = readRepoFile('client/src/views/TransfersView.vue')
const logsViewSource = readRepoFile('client/src/views/LogsView.vue')
const ordersViewSource = readRepoFile('client/src/views/OrdersView.vue')
const invitesViewSource = readRepoFile('client/src/views/InvitesView.vue')
const flashSalesViewSource = readRepoFile('client/src/views/FlashSalesView.vue')
const entertainmentViewSource = readRepoFile('client/src/views/EntertainmentView.vue')
const hostingWalletViewSource = readRepoFile('client/src/views/HostingWalletView.vue')
const userApiSource = readRepoFile('client/src/api/index.ts')
const adminApiSource = readRepoFile('client/src/api/admin.ts')
const appPathsSource = readRepoFile('client/src/utils/app-paths.ts')
const userAppPathsSource = readRepoFile('client/src/utils/app-paths-user.ts')
const adminAppPathsSource = readRepoFile('client/src/utils/app-paths-admin.ts')
const viteConfigSource = readRepoFile('client/vite.config.ts')

const adminEndpointMarkers = [
  '/admin',
  'mail/admin',
  'help/admin',
  'images/admin',
  'inbox/admin',
  'aff/admin',
  'balance/admin',
  'telegram/admin',
  'adminNotificationChannels'
]
const userApiAdminBoundarySource = userApiSource.replaceAll('/admin-password', '/mail-domain-password')

const customerApiForbiddenAdminMarkers = [
  "http.get('/users'",
  'updateRole:',
  "http.patch(`/users/${id}/role`",
  "http.patch(`/users/${id}/status`",
  "http.post(`/users/${id}/quota/recalculate`",
  "http.post(`/users/${id}/reset-password`",
  "http.post(`/users/${id}/disable-2fa`",
  "http.delete(`/users/${userId}/oauth/${provider}`",
  "http.get(`/users/${userId}/login-records`",
  "http.get('/users/detect-linked-accounts'",
  "http.get('/oauth/configs'",
  "http.put(`/oauth/configs/${provider}`",
  "http.delete(`/oauth/configs/${provider}`",
  "http.post('/system-config/smtp/test'",
  "http.post('/system-config/smtp/send-test'",
  "http.get('/system-config')",
  "http.put('/system-config'",
  "http.get(`/users/${userId}/traffic`",
  "http.put(`/users/${userId}/traffic/limit`",
  "http.put(`/instances/${instanceId}/traffic/limit`",
  "http.post('/traffic/collect'",
  "http.post('/traffic/sync-package-limits'"
]

const adminApiForbiddenCustomerAuthMarkers = [
  'RegisterRequest',
  'RegisterResponse',
  "http.post('/auth/register'",
  "http.post('/auth/send-verification-code'",
  "http.post('/auth/forgot-password/send-code'",
  "http.post('/auth/forgot-password/reset'",
  "requestUrl.startsWith('/auth/register')",
  "window.location.pathname.startsWith('/register')"
]

const adminApiForbiddenCustomerSelfServiceMarkers = [
  '\n  billing: {',
  '\n  resourcePool: {',
  '\n  vipLevels: {',
  '\n  vipBenefits: {',
  '\n  userInvites: {',
  '\n  friends: {',
  '\n  transfers: {',
  '\n  checkin: {',
  'UserInvite',
  'UserInviteSummary',
  "http.get('/user-invites",
  "http.get('/friends",
  "http.post('/friends",
  "http.delete(`/friends",
  "http.post(`/packages/${packageId}/share`",
  "http.delete(`/packages/${packageId}/share",
  "http.patch(`/packages/${packageId}/shares",
  "http.get(`/packages/${packageId}/shares`",
  "http.get('/packages/my-shares",
  'listPublic:',
  'getPublicRegions:',
  "http.get(queryString ? `/packages/public?",
  "http.get(queryString ? `/packages/public/regions?",
  "http.get('/packages/hosting-zones",
  "http.get(`/packages/${packageId}/owner-info`",
  "source?: 'official' | 'market' | 'friends' | 'zone'",
  'zoneId?: number',
  "http.get('/transfers",
  "http.post(`/transfers",
  "http.get('/checkin",
  "http.post('/checkin",
  "http.get('/resource-pool",
  "http.post('/resource-pool",
  "http.get('/balance/me",
  "http.get('/recharge/providers",
  "http.post('/recharge/orders",
  "http.get('/recharge/orders",
  "http.get('/recharge/stats",
  "http.post('/instances/batch/renew",
  "http.post('/instances/batch/destroy",
  "http.patch('/instances/batch/auto-renew",
  "http.get('/aff/me",
  "http.post('/aff/me",
  "http.get('/vip-levels/me",
  "http.get('/vip-benefits/me",
  "http.post('/vip-benefits",
  "http.get('/mail/subscription",
  "http.post('/mail/subscription",
  "http.get('/mail/domains",
  "http.post('/mail/domains",
  "http.get('/entertainment/points",
  "http.post('/entertainment/points",
  "http.get('/entertainment/badges",
  "http.post('/entertainment/badges",
  "http.get('/entertainment/lotteries",
  "http.post(`/entertainment/lotteries",
  "http.get('/entertainment/lottery-records",
  "http.get('/hosting/balance",
  "http.get('/hosting/stats",
  "http.get('/hosting/logs",
  "http.post('/hosting/withdraw",
  "http.get('/hosting/withdrawals",
  "http.get('/hosting/blocks",
  "http.post('/hosting/blocks",
  "http.delete(`/hosting/blocks",
  "http.get('/hosting/access-check"
]

const adminReachablePackageViewForbiddenCustomerShareMarkers = [
  'showShareModal',
  'showSharesModal',
  'showEditQuotaModal',
  'openShareModal',
  'sharePackage',
  'loadShares',
  'unsharePackage',
  'openEditQuotaModal',
  'saveEditQuota',
  'getUsagePercent',
  'availableFriends',
  'friendSearchQuery',
  'selectedFriendId',
  'shareLoading',
  'quotaMultiplierOptions',
  'maxInstancesOptions',
  'packageQuota',
  'editingShare',
  'api.packages.share',
  'api.packages.getShares',
  'api.packages.unshare',
  'api.packages.updateShareQuota',
  'resources.packages.shareToFriend',
  'resources.packages.sharesList',
  'resources.packages.editQuota'
]

function assertUniqueRouteNames(name: string, source: string): string[] {
  const routeNames = Array.from(source.matchAll(/^\s{4}name:\s*'([^']+)'/gm)).map(match => match[1])
  const duplicateNames = routeNames.filter((routeName, index) => routeNames.indexOf(routeName) !== index)
  assert.deepEqual(duplicateNames, [], `${name} Vue Router route names must be unique: ${duplicateNames.join(', ')}`)
  return routeNames
}

const userRouteNames = assertUniqueRouteNames('user', userRouterSource)
const adminRouteNames = assertUniqueRouteNames('admin', adminRouterSource)
const userAuthenticatedRoutesWithoutUserGuard = Array.from(
  userRouterSource.matchAll(/path:\s*'([^']+)'[\s\S]*?name:\s*'([^']+)'[\s\S]*?meta:\s*\{([^}]*)\}/g)
)
  .map(match => ({
    path: match[1],
    name: match[2],
    meta: match[3]
  }))
  .filter(route => route.meta.includes('requiresAuth: true') && !route.meta.includes('requiresUser: true'))
  .map(route => `${route.name}:${route.path}`)

assert.ok(!userRouterSource.includes("path: '/admin"), 'customer router must not expose /admin routes')
assert.ok(!userRouterSource.includes('@/views/admin/'), 'customer router must not import admin views')
assert.ok(!userRouterSource.includes('requiresAdmin'), 'customer router must not carry admin-only route metadata')
assert.ok(
  userRouterSource.includes("path: '/plugins/:pathMatch(.*)*'") &&
    userRouterSource.includes('@/views/PluginPageView.vue') &&
    userRouterSource.includes('requiresUser: true') &&
    adminRouterSource.includes("path: '/admin/plugins'") &&
    adminRouterSource.includes('@/views/admin/PluginCenterView.vue') &&
    adminRouterSource.includes("path: '/admin/themes'") &&
    adminRouterSource.includes("redirect: { path: '/admin/plugins', query: { tab: 'themes' } }") &&
    adminRouterSource.includes("titleKey: 'nav.themes'") &&
    adminRouterSource.includes("path: '/admin/integrations'") &&
    adminRouterSource.includes('@/views/admin/IntegrationsView.vue') &&
    adminRouterSource.includes("titleKey: 'nav.integrations'") &&
    sideNavAdminItemsSource.includes("name: 'admin-themes'") &&
    sideNavAdminItemsSource.includes("path: '/admin/themes'") &&
    sideNavAdminItemsSource.includes("label: 'nav.themes'") &&
    sideNavAdminItemsSource.includes("name: 'admin-integrations'") &&
    sideNavAdminItemsSource.includes("path: '/admin/integrations'") &&
    sideNavAdminItemsSource.includes("label: 'nav.integrations'") &&
    !userRouterSource.includes('@/views/admin/PluginCenterView.vue'),
  'plugin center must keep admin management under /admin/plugins, expose formal admin theme/integration entries, and expose only user plugin pages in the customer router'
)
assert.ok(
  userRouterSource.includes("path: '/forgot-password'") &&
    userRouterSource.includes("name: 'forgot-password'") &&
    userRouterSource.includes('@/views/ForgotPasswordView.vue') &&
    userRouterSource.includes('meta: { guest: true }') &&
    appSource.includes("const noLayoutRoutes: string[] = ['login', 'register', 'forgot-password']") &&
    appSource.includes("!noLayoutRoutes.some(name => route.name === name)"),
  'forgot-password must remain a guest auth page without customer app layout or stale-session redirects'
)
assert.deepEqual(
  userAuthenticatedRoutesWithoutUserGuard,
  [],
  'customer authenticated routes must require non-admin users so admin accounts cannot enter the customer panel'
)
assert.ok(adminRouterSource.includes("path: '/admin/users'"), 'admin router must expose admin users route')
assert.ok(adminRouterSource.includes('@/views/admin/UsersView.vue'), 'admin router must import admin views')
assert.ok(adminRouterSource.includes('@/views/admin/AdminLoginView.vue'), 'admin router must import the admin-only login view')
assert.ok(adminRouterSource.includes("from '@/api/admin'"), 'admin router must use the admin API client')
assert.ok(!adminRouterSource.includes("from '@/api'"), 'admin router must not use the customer API client')
assert.ok(
  adminRouterSource.includes("path: '/admin/tickets'") &&
    adminRouterSource.includes("path: '/admin/logs'") &&
    adminRouterSource.includes("path: '/admin/profile'") &&
    adminRouterSource.includes("path: '/admin/inbox'") &&
    adminRouterSource.includes("path: '/admin/instances'") &&
    adminRouterSource.includes("path: '/admin/instances/:id'") &&
    adminRouterSource.includes("path: '/admin/resources/hosts'") &&
    adminRouterSource.includes("path: '/admin/resources/packages'"),
  'admin router must keep shared admin features under the /admin namespace'
)
assert.ok(
  userRouterSource.includes("name: 'instance-detail'") &&
    adminRouterSource.includes("name: 'admin-instance-detail'") &&
    instanceDetailViewSource.includes("'instance-detail'") &&
    instanceDetailViewSource.includes("'admin-instance-detail'") &&
    instanceDetailViewSource.includes('isInstanceDetailRouteName(route.name)') &&
    !instanceDetailViewSource.includes("route.name !== 'instance-detail'"),
  'shared instance detail view must accept both customer and admin detail route names before loading data'
)
assert.ok(
  !adminRouterSource.includes("path: '/tickets'") &&
    !adminRouterSource.includes("path: '/logs'") &&
    !adminRouterSource.includes("path: '/profile'") &&
    !adminRouterSource.includes("path: '/inbox'") &&
    !adminRouterSource.includes("path: '/resources/hosts'") &&
    !adminRouterSource.includes("path: '/resources/packages'"),
  'admin router must not expose customer URL paths for shared pages'
)
assert.ok(!adminRouterSource.includes('@/views/RegisterView.vue'), 'admin router must not expose registration')
assert.ok(!adminRouterSource.includes('@/views/LoginView.vue'), 'admin router must not reuse the customer login view')
assert.ok(!adminRouterSource.includes('@/views/PortalView.vue'), 'admin router must not expose the public portal')
assert.ok(!adminRouterSource.includes('@/views/MarketView.vue'), 'admin router must not expose the public market')
assert.ok(!adminRouteNames.includes('dashboard'), 'admin router must not expose the customer dashboard route')

const portalRoute = sectionBetween(
  userRouterSource,
  "path: '/'",
  "path: '/dashboard'"
)
assert.ok(
  portalRoute.includes("name: 'portal'") &&
    portalRoute.includes("component: () => import('@/views/PortalView.vue')") &&
    portalRoute.includes("titleKey: 'publicSite.nav.overview'"),
  'public / route must render PortalView directly'
)
assert.ok(
  !portalRoute.includes('redirect:'),
  'public / route must not redirect guests to the authenticated dashboard'
)

const marketRoute = sectionBetween(
  userRouterSource,
  "path: '/market'",
  "path: '/instances'"
)

assert.ok(
  marketRoute.includes("name: 'market'") &&
    marketRoute.includes("component: () => import('@/views/MarketView.vue')") &&
    marketRoute.includes("titleKey: 'publicSite.market.title'"),
  'public /market route must render MarketView directly'
)
assert.ok(
  !marketRoute.includes('redirect:'),
  'public /market route must not redirect to authenticated instance creation'
)
assert.equal(
  userRouteNames.filter(name => name === 'instance-create').length,
  1,
  'authenticated instance creation route name must not be duplicated by public market routing'
)

assert.ok(
  publicHeaderSource.includes("import { dashboardPath, helpPath, loginPath, marketPath, registerPath } from '@/utils/app-paths'") &&
    publicHeaderSource.includes("to: '/'") &&
    publicHeaderSource.includes('to: marketPath()') &&
    publicHeaderSource.includes('to: helpPath()') &&
    publicHeaderSource.includes('const consoleTarget = computed(() => dashboardPath())') &&
    publicHeaderSource.includes('router.push(registerPath())') &&
    publicHeaderSource.includes('router.push(loginPath())') &&
    !publicHeaderSource.includes("router.push('/register')") &&
    !publicHeaderSource.includes("router.push('/login')") &&
    publicFooterSource.includes("{ to: '/', label: t('publicSite.nav.overview') }") &&
    publicFooterSource.includes("import { dashboardPath, forgotPasswordPath, helpPath, loginPath, marketPath, registerPath } from '@/utils/app-paths'") &&
    publicFooterSource.includes("to: marketPath()") &&
    publicFooterSource.includes(':to="helpPath()"') &&
    publicFooterSource.includes("to: loginPath()") &&
    publicFooterSource.includes("to: registerPath()") &&
    publicFooterSource.includes("to: forgotPasswordPath()") &&
    publicFooterSource.includes('const consoleTarget = computed(() => dashboardPath())') &&
    !publicFooterSource.includes("router.push('/register')") &&
    !publicFooterSource.includes("router.push('/login')") &&
    !publicFooterSource.includes("to: '/forgot-password'") &&
    portalViewSource.includes("name: 'PortalView'") &&
    marketViewSource.includes("name: 'MarketView'"),
  'public navigation links to / and /market must land on the real public views'
)
assert.ok(
  portalViewSource.includes("import { dashboardPath, loginPath, marketPath } from '@/utils/app-paths'") &&
    portalViewSource.includes("path: marketPath()") &&
    !portalViewSource.includes('openAdminConsole') &&
    portalViewSource.includes("void router.push(dashboardPath())") &&
    portalViewSource.includes("void router.push(loginPath())") &&
    !portalViewSource.includes("path: '/market'") &&
    !portalViewSource.includes("void router.push('/dashboard')") &&
    !portalViewSource.includes("void router.push('/login')"),
  'PortalView CTA must browse the public market and keep authenticated users on the customer console or guests on customer login'
)
assert.ok(
  oauthAuthorizeViewSource.includes("import { dashboardPath } from '@/utils/app-paths'") &&
    oauthAuthorizeViewSource.includes('router.push(dashboardPath())') &&
    !oauthAuthorizeViewSource.includes("router.push('/dashboard')") &&
    pluginPageViewSource.includes("import { dashboardPath } from '@/utils/app-paths'") &&
    pluginPageViewSource.includes(':to="dashboardPath()"') &&
    !pluginPageViewSource.includes('to="/dashboard"'),
  'OAuth authorize and plugin fallback pages must return to the customer console through app path helpers'
)
assert.ok(
  !userRouterSource.includes('openAdminLogin') &&
    userRouterSource.includes("next({ name: 'login', query: { adminOnly: '1' } })") &&
    userRouterSource.includes('if ((to.meta.requiresAuth || to.meta.requiresUser) && authStore.isAdmin)') &&
    !loginViewSource.includes('isAdminEntry') &&
    !loginViewSource.includes('后台管理系统') &&
    !loginViewSource.includes('/admin/users') &&
    loginViewSource.includes("import { forgotPasswordPath, registerPath } from '@/utils/app-paths'") &&
    loginViewSource.includes(':to="registerPath()"') &&
    loginViewSource.includes(':to="forgotPasswordPath()"') &&
    !loginViewSource.includes('to="/register"') &&
    !loginViewSource.includes('to="/forgot-password"') &&
    loginViewSource.includes('authStore.isAdmin') &&
    loginViewSource.includes('管理员账号请使用独立管理后台登录') &&
    adminLoginViewSource.includes('后台管理系统') &&
    adminLoginViewSource.includes('该入口仅限管理员登录') &&
    adminLoginViewSource.includes('仅限管理员账号登录') &&
    adminLoginViewSource.includes("'/admin/users'") &&
    adminLoginViewSource.includes("from '@/api/admin'") &&
    adminRouterSource.includes("path: '/admin/login'") &&
    adminRouterSource.includes("path: '/login'") &&
    adminRouterSource.includes("path: '/admin/login',") &&
    adminRouterSource.includes('query: to.query') &&
    adminAppSource.includes("const adminLoginPath = '/admin/login'") &&
    adminAppSource.includes('window.location.href = adminLoginPath') &&
    !adminAppSource.includes("window.location.href = '/login'") &&
    adminApiSource.includes("const ADMIN_LOGIN_PATH = '/admin/login'") &&
    adminApiSource.includes('window.location.href = ADMIN_LOGIN_PATH') &&
    !adminApiSource.includes("window.location.href = '/login'") &&
    !adminLoginViewSource.includes('to="/register"') &&
    !adminLoginViewSource.includes('to="/forgot-password"') &&
    !loginViewSource.includes('openAdminLogin') &&
    !registerViewSource.includes('openAdminLogin') &&
    !publicHeaderSource.includes('getAdminConsoleUrl') &&
    !publicFooterSource.includes('getAdminConsoleUrl') &&
    !publicHeaderSource.includes('window.location.href = consoleTarget.value') &&
    !publicFooterSource.includes('window.location.href = consoleTarget.value'),
  'customer frontend must not cross-redirect to the admin host, while the admin frontend still rejects non-admin users'
)
assert.deepEqual(
  adminEndpointMarkers.filter(marker => userApiAdminBoundarySource.includes(marker)),
  [],
  'customer API client must not contain admin endpoint strings or admin API namespaces'
)
assert.ok(
  userApiSource.includes('/plugins/enabled-client-extensions') &&
    userApiSource.includes('/plugins/${pluginId}/config/public') &&
    userApiSource.includes('/plugins/${pluginId}/actions/${action}') &&
    !userApiSource.includes('/admin/plugins') &&
    adminApiSource.includes('/admin/plugins') &&
    adminApiSource.includes('/admin/plugins/upload') &&
    adminApiSource.includes('/admin/plugins/market/install'),
  'plugin API clients must keep user extension APIs separate from admin plugin management APIs'
)
assert.deepEqual(
  customerApiForbiddenAdminMarkers.filter(marker => userApiSource.includes(marker)),
  [],
  'customer API client must not expose admin-only account, system, OAuth config, or traffic-management methods'
)
assert.ok(
  adminEndpointMarkers.some(marker => adminApiSource.includes(marker)) &&
    adminApiSource.includes("admin: {") &&
    adminApiSource.includes("adminNotificationChannels:"),
  'admin API client must retain admin endpoints separately from the customer API client'
)
assert.ok(
  adminApiSource.includes('CreateInstanceResponse') &&
    adminApiSource.includes('create: (data: CreateInstanceRequest): Promise<CreateInstanceResponse>'),
  'admin API instance create must use the shared create response contract with nested instance details'
)
assert.deepEqual(
  adminApiForbiddenCustomerAuthMarkers.filter(marker => adminApiSource.includes(marker)),
  [],
  'admin API client must not expose customer registration or forgot-password self-service methods'
)
assert.deepEqual(
  adminApiForbiddenCustomerSelfServiceMarkers.filter(marker => adminApiSource.includes(marker)),
  [],
  'admin API client must not expose customer-only invite, friend, transfer, check-in, billing, VIP, resource-pool, AFF, mail, entertainment, or hosting-balance self-service modules'
)
assert.deepEqual(
  adminReachablePackageViewForbiddenCustomerShareMarkers.filter(marker => myPackagesViewSource.includes(marker)),
  [],
  'admin-reachable package view must not retain disabled customer friend-share UI, state, or package share API calls'
)
assert.ok(
  !authStoreSource.includes('RegisterRequest') &&
    !authStoreSource.includes('async function register(') &&
    !authStoreSource.includes('api.auth.register') &&
    registerViewSource.includes("import { dashboardPath, loginPath } from '@/utils/app-paths'") &&
    registerViewSource.includes('api.auth.register') &&
    registerViewSource.includes('authStore.syncToken()') &&
    registerViewSource.includes('authStore.fetchCurrentUser()') &&
    loginViewSource.includes('await router.replace(safeRedirect)') &&
    registerViewSource.includes('await router.replace(dashboardPath())') &&
    registerViewSource.includes('router.push(loginPath())') &&
    registerViewSource.includes(':to="loginPath()"') &&
    userRouterSource.includes("next({ name: 'dashboard', replace: true })") &&
    !registerViewSource.includes("router.push('/dashboard')") &&
    !registerViewSource.includes("router.push('/login')") &&
    !registerViewSource.includes('to="/login"'),
  'shared auth store must not expose customer registration; registration belongs only to RegisterView in the customer entry'
)
assert.ok(
  forgotPasswordViewSource.includes("import { loginPath } from '@/utils/app-paths'") &&
    forgotPasswordViewSource.includes("import { translateError } from '@/utils/errorHandler'") &&
    countOccurrences(forgotPasswordViewSource, 'error.value = translateError(err)') >= 2 &&
    forgotPasswordViewSource.includes('router.push(loginPath())') &&
    forgotPasswordViewSource.includes(':to="loginPath()"') &&
    !forgotPasswordViewSource.includes('error.value = err?.message') &&
    !forgotPasswordViewSource.includes("router.push('/login')") &&
    !forgotPasswordViewSource.includes('to="/login"'),
  'ForgotPasswordView must route back to customer login through the shared path helper and localize API failure states'
)
assert.ok(
    registerViewSource.includes('function resetTurnstileChallenge(): void') &&
    registerViewSource.includes('turnstileRef.value?.reset?.()') &&
    registerViewSource.includes('resetTurnstileChallenge()') &&
    registerViewSource.includes('error.value = translateError(err)\n    resetTurnstileChallenge()'),
  'RegisterView must reset only the Turnstile challenge after register failures so invite-code correction keeps the filled form'
)
for (const [viewName, source, helperName] of [
  ['LoginView', loginViewSource, 'getLoginTurnstileToken'],
  ['RegisterView', registerViewSource, 'getRegisterTurnstileToken'],
  ['ForgotPasswordView', forgotPasswordViewSource, 'getForgotPasswordTurnstileToken']
] as const) {
  assert.ok(
    source.includes("from '@/utils/turnstile'") &&
      source.includes('const turnstileSectionRef = ref<HTMLElement | null>(null)') &&
      source.includes(`function ${helperName}`) &&
      source.includes('const isTurnstileChallengeAvailable = computed<boolean>(() => turnstileEnabled.value && Boolean(turnstileSiteKey.value))') &&
      source.includes('if (!isTurnstileChallengeAvailable.value) return undefined') &&
      source.includes('v-if="isTurnstileChallengeAvailable"') &&
      source.includes('readTurnstileToken(turnstileRef.value, turnstileToken.value)') &&
      source.includes('focusTurnstileSection(turnstileSectionRef.value)') &&
      source.includes('ref="turnstileSectionRef"') &&
      source.includes('tabindex="-1"'),
    `${viewName} must read Turnstile tokens from the widget/hidden input and focus the visible challenge when missing`
  )
}
assert.ok(
  walletViewSource.includes('const providersLoading = ref(false)') &&
    walletViewSource.includes('function resetRechargeProviderSelection()') &&
    walletViewSource.includes('providers.value = []') &&
    walletViewSource.includes('selectedProvider.value = null') &&
    walletViewSource.includes('providersLoading.value = true') &&
    walletViewSource.includes('v-if="providersLoading"') &&
    walletViewSource.includes('v-else-if="providers.length === 0"') &&
    walletViewSource.includes(':disabled="providersLoading || rechargeLoading || !selectedProvider') &&
    walletViewSource.includes('if (providersLoading.value)'),
  'wallet recharge modal must clear stale payment providers, show a loading state, and block order creation while providers load'
)
assert.ok(
  mainSource.includes("import clientPackage from '../package.json'") &&
    mainSource.includes('const serviceWorkerUrl = `/sw.js?v=${encodeURIComponent(clientPackage.version)}`') &&
    mainSource.includes('shouldReloadForServiceWorkerControllerChange(clientPackage.version)') &&
    mainSource.includes("navigator.serviceWorker.register(serviceWorkerUrl, { updateViaCache: 'none' })") &&
    adminMainSource.includes("import clientPackage from '../../package.json'") &&
    adminMainSource.includes('const serviceWorkerUrl = `/sw.js?v=${encodeURIComponent(clientPackage.version)}`') &&
    adminMainSource.includes('shouldReloadForServiceWorkerControllerChange(clientPackage.version)') &&
    adminMainSource.includes("navigator.serviceWorker.register(serviceWorkerUrl, { updateViaCache: 'none' })"),
  'user and admin entries must register a versioned Service Worker URL with updateViaCache disabled and avoid repeated controllerchange reloads'
)
assert.ok(
  staleAssetRecoverySource.includes("window.addEventListener('vite:preloadError'") &&
    staleAssetRecoverySource.includes("window.addEventListener('unhandledrejection'") &&
    staleAssetRecoverySource.includes("window.addEventListener('error'") &&
    staleAssetRecoverySource.includes("cacheName.startsWith('incudal-cache-')") &&
    staleAssetRecoverySource.includes("const STALE_ASSET_RELOAD_SIGNATURE_KEY = 'incudal:stale-asset-reload-signature'") &&
    staleAssetRecoverySource.includes("window.sessionStorage.getItem(STALE_ASSET_RELOAD_SIGNATURE_KEY) === signature") &&
    staleAssetRecoverySource.includes("const SERVICE_WORKER_RELOAD_KEY_PREFIX = 'incudal:service-worker-controller-reloaded:'") &&
    staleAssetRecoverySource.includes('window.location.reload()') &&
    mainSource.includes('installStaleAssetRecovery()') &&
    adminMainSource.includes('installStaleAssetRecovery()') &&
    userRouterSource.includes("scheduleStaleAssetReload('user-router-error'") &&
    adminRouterSource.includes("scheduleStaleAssetReload('admin-router-error'") &&
    appSource.includes("scheduleStaleAssetReload('app-error-captured'") &&
    adminAppSource.includes("scheduleStaleAssetReload('admin-app-error-captured'"),
  'user and admin frontends must recover from stale Vite chunks/preload failures without entering reload loops'
)
assert.ok(
  !indexHtmlSource.includes('https://mcp.figma.com/mcp/html-to-design/capture.js'),
  'production index.html must not load the Figma capture script'
)
assert.ok(
  turnstileWidgetSource.includes("verificationState = ref<'pending' | 'verified' | 'expired' | 'error'>('pending')") &&
    turnstileWidgetSource.includes("t('common.turnstileStatusTitle')") &&
    turnstileWidgetSource.includes("t('common.turnstileUnverified')") &&
    turnstileWidgetSource.includes("t('common.turnstileVerified')") &&
    turnstileWidgetSource.includes('class="turnstile-status-row"') &&
    turnstileWidgetSource.includes('class="turnstile-status-pill"') &&
    turnstileWidgetSource.includes("verificationState.value = 'verified'") &&
    turnstileWidgetSource.includes("verificationState.value = 'pending'"),
  'TurnstileWidget must show a fixed verification status row so users can distinguish unverified and verified states'
)
assert.ok(
  appPathsSource.includes("export function exchangePath(): string") &&
    appPathsSource.includes("return '/exchange'") &&
    userAppPathsSource.includes("export function exchangePath(): string") &&
    userAppPathsSource.includes("return '/exchange'") &&
    adminAppPathsSource.includes("export function exchangePath(): string") &&
    adminAppPathsSource.includes("return '/admin/exchange'"),
  'app path helpers must provide user/admin exchange routes for shared instance screens'
)
assert.ok(
  adminUsersViewSource.includes('import.meta.env.VITE_CUSTOMER_BASE_URL') &&
    adminUsersViewSource.includes('window.location.origin') &&
    adminUsersViewSource.includes('return `${customerBaseUrl.value}/register/${newInviteCode.value}`') &&
    !adminUsersViewSource.includes('return `${window.location.origin}/register/${newInviteCode.value}`'),
  'admin generated invite links must point to the configured customer frontend origin, not the admin origin'
)
assert.ok(
  helpViewSource.includes('function isHelpArticleNotFoundError(err: unknown): boolean') &&
    helpViewSource.includes("maybeError.code === 'ARTICLE_NOT_FOUND'") &&
    helpViewSource.includes("articleError.value = isHelpArticleNotFoundError(err) ? t('help.articleNotFound') : t('help.loadFailed')"),
  'Help article detail must render ARTICLE_NOT_FOUND as a not-found empty state instead of a generic load failure'
)
assert.ok(
  oauthAuthorizeViewSource.includes('function describeConsentError(err: unknown): { message: string; hint: string }') &&
    oauthAuthorizeViewSource.includes("apiError?.code === 'OAUTH_CONSENT_FAILED'") &&
    oauthAuthorizeViewSource.includes('授权应用不可用') &&
    oauthAuthorizeViewSource.includes('errorHint.value = friendlyError.hint') &&
    oauthAuthorizeViewSource.includes('v-if="errorHint"'),
  'OAuth authorize must show a clear unavailable-app hint for invalid or disabled OAuth client consent failures'
)
assert.ok(
  appSource.includes("import PublicSiteLayout from '@/components/public/PublicSiteLayout.vue'") &&
    appSource.includes("const publicSiteRouteNames = new Set(['portal', 'market', 'help', 'help-article'])") &&
    appSource.includes('const showPublicSiteLayout = computed<boolean>') &&
    appSource.includes('!showPublicSiteLayout.value') &&
    appSource.includes('<PublicSiteLayout v-else-if="showPublicSiteLayout">'),
  'App shell must wrap public portal, market, and help routes with the public site header/footer layout'
)
const authenticatedAppShell = sectionBetween(
  appSource,
  '<AppLayout v-if="showLayout">',
  '<PublicSiteLayout v-else-if="showPublicSiteLayout">'
)
assert.ok(
  authenticatedAppShell.includes('<Transition name="kawaii-route">') &&
    !authenticatedAppShell.includes('mode="out-in"') &&
    authenticatedAppShell.includes("'InstancesView'") &&
    authenticatedAppShell.includes("'InstanceCreateView'"),
  'authenticated App shell must not out-in transition cached route switches, and InstancesView must stay outside KeepAlive so create-instance submit returns to a rendered list instead of a blank workspace'
)
assert.ok(
  adminMainSource.includes("import App from './AdminApp.vue'") &&
    adminAppSource.includes("const noLayoutRoutes: string[] = ['login']") &&
    !adminAppSource.includes('PublicSiteLayout') &&
    !adminAppSource.includes('PopupAnnouncementModal') &&
    !adminAppSource.includes("window.location.pathname.startsWith('/register')"),
  'admin app shell must be separate from the public/customer app shell'
)
assert.ok(
  appLayoutSource.includes("const isAdminEntry = import.meta.env.VITE_APP_ENTRY === 'admin'") &&
    appLayoutSource.includes("import { instancesPath, loginPath, profilePath, terminalPath } from '@/utils/app-paths'") &&
    appLayoutSource.includes('const accountProfilePath = profilePath()') &&
    appLayoutSource.includes('const accountTerminalPath = terminalPath()') &&
    appLayoutSource.includes('const accountInstancesPath = instancesPath()') &&
    appLayoutSource.includes('const accountLoginPath = loginPath()') &&
    appLayoutSource.includes('router.push(accountLoginPath)') &&
    !appLayoutSource.includes("router.push('/login')") &&
    appLayoutSource.includes('v-if="!isAdminEntry"') &&
    appLayoutSource.includes('@click="router.push(accountTerminalPath)"') &&
    !appLayoutSource.includes("@click=\"router.push('/terminal')\"") &&
    appLayoutSource.includes('@click="navigateTo(accountInstancesPath)"') &&
    !appLayoutSource.includes("navigateTo('/instances')"),
  'shared authenticated layout must hide customer-only terminal and instance shortcuts in the admin entry'
)
assert.ok(
  sideNavSource.includes("from '@/config/side-nav-items'") &&
    sideNavSource.includes("import { dashboardPath } from '@/utils/app-paths'") &&
    sideNavSource.includes('const navDashboardPath = dashboardPath()') &&
    sideNavSource.includes("if (item.name === 'dashboard') return route.path === navDashboardPath") &&
    sideNavSource.includes(':to="navDashboardPath"') &&
    !sideNavSource.includes("return route.path === '/dashboard'") &&
    !sideNavSource.includes('RouterLink to="/"') &&
    sideNavSource.includes('let baseItems = [...navMenuItems]') &&
    sideNavSource.includes('PluginSlot') &&
    sideNavSource.includes('v-if="!isAdminEntry"') &&
    sideNavSource.includes('slot-name="user.sidebar.extra"') &&
    pluginSlotSource.includes('getEnabledClientExtensions') &&
    pluginFrameSource.includes('sandbox=') &&
    sideNavUserItemsSource.includes("path: '/resources/hosts'") &&
    sideNavUserItemsSource.includes("path: '/resources/packages'") &&
    !sideNavUserItemsSource.includes('/admin/') &&
    sideNavAdminItemsSource.includes("path: '/admin/tickets'") &&
    sideNavAdminItemsSource.includes("path: '/admin/profile'") &&
    sideNavAdminItemsSource.includes("path: '/admin/resources/hosts'"),
  'shared SideNav menu tables must be build-time aliased so customer bundles do not keep admin navigation entries'
)
assert.ok(
  viteConfigSource.includes("name: 'payincus-admin-locale-prune'") &&
    viteConfigSource.includes('stripAdminOnlyLocaleMessages(code)') &&
    viteConfigSource.includes('userOnlyTopLevelKeys') &&
    viteConfigSource.includes('disabledPackageShareKeys'),
  'admin builds must prune user-only locale messages so customer text tables are not bundled into the admin entry'
)
assert.ok(
  viteConfigSource.includes("name: 'payincus-user-locale-prune'") &&
    viteConfigSource.includes('stripUserOnlyLocaleMessages(code)') &&
    viteConfigSource.includes('adminOnlyTopLevelKeys') &&
    viteConfigSource.includes('adminOnlyNavKeys') &&
    viteConfigSource.includes('sharedUserKeys'),
  'customer builds must prune admin-only locale messages while preserving shared host/package text used by customer-reachable pages'
)
assert.ok(
    appPathsSource.includes('export const isAdminEntry = false') &&
    appPathsSource.includes("return '/login'") &&
    !appPathsSource.includes('/admin/') &&
    userAppPathsSource.includes("return '/login'") &&
    userAppPathsSource.includes('export function registerPath(inviteCode?: string): string') &&
    userAppPathsSource.includes("`/register/${encodeURIComponent(inviteCode)}` : '/register'") &&
    userAppPathsSource.includes("return '/forgot-password'") &&
    userAppPathsSource.includes("return '/market'") &&
    userAppPathsSource.includes("return '/resources/hosts'") &&
    userAppPathsSource.includes("return '/resources/packages'") &&
    userAppPathsSource.includes("return '/wallet'") &&
    userAppPathsSource.includes("return '/help'") &&
    userAppPathsSource.includes("return '/inbox'") &&
    userAppPathsSource.includes("return '/mail'") &&
    userAppPathsSource.includes('return `/mail/domains/${encodeURIComponent(String(id))}`') &&
    userAppPathsSource.includes("return '/terminal'") &&
    userAppPathsSource.includes("return '/extensions'") &&
    userAppPathsSource.includes("return '/entertainment'") &&
    userAppPathsSource.includes("return '/instances'") &&
    userAppPathsSource.includes("return '/instances/create'") &&
    adminAppPathsSource.includes("return '/admin/login'") &&
    adminAppPathsSource.includes("return '/admin/resources/packages'") &&
    adminAppPathsSource.includes("return '/admin/profile'") &&
    adminAppPathsSource.includes("return '/admin/billing'") &&
    adminAppPathsSource.includes("return '/admin/help'") &&
    adminAppPathsSource.includes("return '/admin/inbox'") &&
    adminAppPathsSource.includes("return '/admin/mail'") &&
    adminAppPathsSource.includes('export function mailDomainPath(_id?: number | string): string') &&
    adminAppPathsSource.includes("return '/admin/entertainment'") &&
    adminAppPathsSource.includes("return '/admin/instances'") &&
    adminAppPathsSource.includes('return null') &&
    adminAppPathsSource.includes("return '/admin/instances'") &&
    adminAppPathsSource.includes("return '/admin/instances/create'") &&
    adminAppPathsSource.includes("return '/admin/resources/hosts'") &&
    adminAppPathsSource.includes("return '/admin/resources/packages'"),
  'shared views must use build-time aliased app path helpers for customer/admin URL separation'
)
assert.ok(
  passwordSectionSource.includes("import { loginPath } from '@/utils/app-paths'") &&
    passwordSectionSource.includes('const reauthLoginPath = loginPath()') &&
    passwordSectionSource.includes('window.location.href = reauthLoginPath') &&
    !passwordSectionSource.includes("window.location.href = '/login'"),
  'shared profile password section must redirect reauth to the build-specific login path'
)
assert.ok(
  adminUsersViewSource.includes("import { instancesPath } from '@/utils/app-paths'") &&
    adminUsersViewSource.includes('path: instancesPath()') &&
    adminBillingViewSource.includes("import { instanceDetailPath } from '@/utils/app-paths'") &&
    !adminBillingViewSource.includes('`/instances/${inst.id}`') &&
    instancesViewSource.includes('instanceCreatePath') &&
    instancesViewSource.includes('instanceDetailPath') &&
    !instancesViewSource.includes('router.push(`/instances/${instanceId}`)') &&
    !instancesViewSource.includes('to="/instances/create"') &&
    instanceDetailViewSource.includes('instancesPath()') &&
    myHostsViewSource.includes("import { hostCreatePath, hostDetailPath, isAdminEntry } from '@/utils/app-paths'") &&
    myHostsViewSource.includes("if (isAdminEntry || authStore.user?.role === 'admin')") &&
    hostInstancesTabSource.includes('instanceDetailPath(id)') &&
    hostCreateInstanceTabSource.includes('instanceDetailPath(result.instance.id)') &&
    ticketInstanceOwnerCardSource.includes('instanceDetailPath(props.instanceSummary.id)') &&
    myPackagesViewSource.includes("import { instanceCreatePath, isAdminEntry, packageCreatePath, packageEditPath } from '@/utils/app-paths'") &&
    myPackagesViewSource.includes('if (isAdminEntry) return') &&
    myPackagesViewSource.includes('${window.location.origin}${instanceCreatePath()}?source=${source}&package=${pkg.id}') &&
    myPackagesViewSource.includes('v-if="!isAdminEntry"') &&
    myPackagesViewSource.includes('class="space-y-3 p-4 lg:hidden"') &&
    myPackagesViewSource.includes('class="hidden overflow-hidden lg:block"') &&
    myPackagesViewSource.includes('class="w-full table-fixed text-sm"') &&
    myPackagesViewSource.includes('class="rounded-lg border border-themed bg-themed-surface p-4 shadow-sm"') &&
    myPackagesViewSource.includes('class="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-themed pt-3"') &&
    myPackagesViewSource.includes('@click="copyShareLink(pkg)"') &&
    myPackagesViewSource.includes('@click="openPlansModal(pkg)"') &&
    myPackagesViewSource.includes('@click="openQuotaReleaseModal(pkg)"') &&
    myPackagesViewSource.includes('@click="openEdit(pkg)"') &&
    myPackagesViewSource.includes('@click="togglePackageActive(pkg)"') &&
    myPackagesViewSource.includes('@click="deletePackage(pkg)"') &&
    !myPackagesViewSource.includes('class="w-full min-w-[1120px] table-fixed text-sm"') &&
    !myPackagesViewSource.includes('<table class="w-full text-sm"'),
  'admin-reachable shared instance pages must use app path helpers and MyPackagesView must render mobile package cards plus a fixed desktop table without PC horizontal overflow'
)
assert.ok(
  countOccurrences(adminBillingViewSource, 'class="space-y-3 p-4 lg:hidden"') >= 2 &&
    countOccurrences(adminBillingViewSource, 'table class="w-full table-fixed text-sm"') >= 4 &&
    adminBillingViewSource.includes('table class="hidden w-full table-fixed text-sm lg:table"') &&
    adminBillingViewSource.includes('@change="toggleSelectAllCurrentPage"') &&
    adminBillingViewSource.includes('@click="openBatchPriceModal"') &&
    adminBillingViewSource.includes('@click="openPriceModal(inst)"') &&
    adminBillingViewSource.includes("@click=\"openActionModal('unsuspend', inst)\"") &&
    adminBillingViewSource.includes("@click=\"openActionModal('extend', inst)\"") &&
    adminBillingViewSource.includes('@click="openUpgradeModal(inst)"') &&
    adminBillingViewSource.includes("@click=\"openActionModal('applyDiscount', inst)\"") &&
    adminBillingViewSource.includes("@click=\"openActionModal('deleteRefund', inst)\"") &&
    adminBillingViewSource.includes('@click="submitBatchUpdatePrice"') &&
    adminBillingViewSource.includes('@click="openCreateOriginalRefund(rec)"') &&
    adminBillingViewSource.includes('@click="syncRechargeRecord(rec)"') &&
    adminBillingViewSource.includes('@click="retryRechargeRefund(refund)"') &&
    adminBillingViewSource.includes('batchPricePreviewHasVersionSnapshot') &&
    !adminBillingViewSource.includes('<div class="overflow-x-auto">') &&
    !adminBillingViewSource.includes('class="hidden overflow-x-auto md:block"') &&
    !adminBillingViewSource.includes('table class="w-full min-w-[720px] text-sm"') &&
    !adminBillingViewSource.includes('table class="w-full text-sm"') &&
    !adminBillingViewSource.includes('class="grid min-w-[520px]'),
  'admin billing instance, record, recharge, refund, and batch price preview lists must use responsive cards/fixed tables while preserving selection, payment sync, original refund, refund retry, price, upgrade, and guarded submit actions'
)
assert.ok(
  instancesViewSource.includes('walletPath()') &&
    !instancesViewSource.includes('to="/wallet"') &&
    instanceDetailViewSource.includes('helpPath()') &&
    !instanceDetailViewSource.includes('to="/help"') &&
    instanceDetailViewSource.includes('exchangePath()') &&
    !instanceDetailViewSource.includes("path: '/exchange'") &&
    !instanceDetailViewSource.includes('path: "/exchange"') &&
    instancesViewSource.includes('exchangePath()') &&
    !instancesViewSource.includes("path: '/exchange'") &&
    !instancesViewSource.includes('path: "/exchange"') &&
    instanceCreateViewSource.includes('profilePath()') &&
    !instanceCreateViewSource.includes('to="/profile"') &&
    helpViewSource.includes("import { helpPath } from '@/utils/app-paths'") &&
    helpViewSource.includes('router.push(helpPath())') &&
    !helpViewSource.includes("router.push('/help')") &&
    ticketsViewSource.includes("import { ticketsPath } from '@/utils/app-paths'") &&
    ticketsViewSource.includes('path: ticketsPath()') &&
    !ticketsViewSource.includes("name: 'tickets'") &&
    renewModalSource.includes('walletPath()') &&
    !renewModalSource.includes('href="/wallet"') &&
    changePlanModalSource.includes('walletPath()') &&
    !changePlanModalSource.includes('href="/wallet"') &&
    walletViewSource.includes("import { instanceDetailPath, walletPath } from '@/utils/app-paths'") &&
    walletViewSource.includes('router.replace({ path: walletPath() })') &&
    walletViewSource.includes('router.push(instanceDetailPath(log.instanceId))') &&
    !walletViewSource.includes("router.replace({ path: '/wallet' })") &&
    !walletViewSource.includes('router.push(`/instances/${log.instanceId}`)'),
  'admin-reachable shared pages must not hardcode customer-only wallet/help/ticket routes'
)
assert.ok(
  myHostsViewSource.includes('class="grid gap-3 lg:hidden"') &&
    myHostsViewSource.includes('role="button"') &&
    myHostsViewSource.includes('@keydown.enter.prevent="goToDetail(host)"') &&
    myHostsViewSource.includes('class="card hidden overflow-hidden lg:block"') &&
    myHostsViewSource.includes('class="w-full table-fixed"') &&
    !myHostsViewSource.includes('<div class="overflow-x-auto">') &&
    !myHostsViewSource.includes('class="w-full min-w-[800px]"'),
  'MyHostsView must use mobile host cards and a fixed desktop table without PC horizontal overflow'
)
assert.ok(
  hostPublicIpv4TabSource.includes('class="w-full table-fixed text-sm"') &&
    hostPublicIpv4TabSource.includes('@click="addAddresses(pool.id)"') &&
    hostPublicIpv4TabSource.includes('@click="toggleAddress(address)"') &&
    hostPublicIpv4TabSource.includes('@click="deleteAddress(address)"') &&
    !hostPublicIpv4TabSource.includes('<div class="overflow-x-auto">'),
  'HostPublicIpv4Tab must render IPv4 pools without table horizontal overflow while preserving add, toggle, and delete actions'
)
assert.ok(
  instanceLogsTabSource.includes('class="card overflow-hidden hidden sm:block"') &&
    instanceLogsTabSource.includes('class="w-full table-fixed"') &&
    instanceLogsTabSource.includes('@click="toggleContent(log.id)"') &&
    instanceLogsTabSource.includes('@click="handleSearch"') &&
    instanceLogsTabSource.includes('@click="resetFilters"') &&
    !instanceLogsTabSource.includes('<div class="overflow-x-auto">') &&
    !instanceLogsTabSource.includes('class="w-full min-w-[600px]"'),
  'InstanceLogsTab must keep desktop logs in a fixed table without horizontal overflow while preserving search, reset, and expand actions'
)
assert.ok(
  configEditModalSource.includes('class="overflow-hidden"') &&
    configEditModalSource.includes('class="w-full table-fixed"') &&
    configEditModalSource.includes('@click="handleClose"') &&
    configEditModalSource.includes('@input="handleCpuInput(($event.target as HTMLInputElement).value)"') &&
    configEditModalSource.includes('@input="handleMemoryInput(($event.target as HTMLInputElement).value)"') &&
    configEditModalSource.includes('@input="handleDiskInput(($event.target as HTMLInputElement).value)"') &&
    configEditModalSource.includes('@input="handleTrafficInput(($event.target as HTMLInputElement).value)"') &&
    !configEditModalSource.includes('<div class="overflow-x-auto">'),
  'ConfigEditModal must use fixed resource rows without horizontal overflow while preserving close and resource input handlers'
)
assert.ok(
  transfersViewSource.includes('class="space-y-3 lg:hidden"') &&
    transfersViewSource.includes('class="card hidden overflow-hidden lg:block"') &&
    transfersViewSource.includes('class="w-full table-fixed"') &&
    transfersViewSource.includes('class="truncate font-medium"') &&
    transfersViewSource.includes('class="flex flex-wrap items-center justify-end gap-2"') &&
    transfersViewSource.includes('@click="openConfigModal(transfer)"') &&
    transfersViewSource.includes('@click="handleAccept(transfer)"') &&
    transfersViewSource.includes('@click="handleCancel(transfer)"') &&
    transfersViewSource.includes('@click="handlePush(transfer)"') &&
    !transfersViewSource.includes('<div class="overflow-x-auto">') &&
    !transfersViewSource.includes('class="w-full min-w-[960px] table-fixed"'),
  'TransfersView must provide compact mobile cards and a fixed-layout desktop table without PC horizontal overflow while preserving all transfer actions'
)
assert.ok(
  logsViewSource.includes('class="space-y-3 lg:hidden"') &&
    logsViewSource.includes('class="card hidden overflow-hidden lg:block"') &&
    logsViewSource.includes('class="w-full table-fixed"') &&
    logsViewSource.includes('class="rounded-lg border border-themed bg-themed-surface p-4 shadow-sm"') &&
    logsViewSource.includes('class="max-w-full"') &&
    logsViewSource.includes('@click="toggleContent(log.id)"') &&
    !logsViewSource.includes('<div class="overflow-x-auto">') &&
    !logsViewSource.includes('class="card overflow-x-auto"') &&
    !logsViewSource.includes('class="w-full min-w-[980px] table-fixed"') &&
    !logsViewSource.includes('class="w-full min-w-[920px]"'),
  'LogsView must use mobile log cards and a fixed-layout audit table without PC horizontal overflow'
)
assert.ok(
  ordersViewSource.includes('class="space-y-3 p-4 lg:hidden"') &&
    ordersViewSource.includes('class="hidden overflow-hidden lg:block"') &&
    ordersViewSource.includes('class="w-full table-fixed divide-y divide-themed"') &&
    ordersViewSource.includes('class="rounded-lg border border-themed bg-themed-surface p-4 shadow-sm"') &&
    ordersViewSource.includes('@click="openDetail(order)"') &&
    ordersViewSource.includes('class="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:flex"') &&
    !ordersViewSource.includes('<div class="overflow-x-auto">') &&
    !ordersViewSource.includes('class="w-full min-w-[960px] table-fixed divide-y divide-themed"') &&
    !ordersViewSource.includes('<table class="min-w-full divide-y divide-themed"'),
  'OrdersView must render mobile order cards and a fixed-layout desktop table without PC horizontal overflow while preserving detail access'
)
assert.ok(
  invitesViewSource.includes("import { dashboardPath } from '@/utils/app-paths'") &&
    invitesViewSource.includes(':to="dashboardPath()"') &&
    !invitesViewSource.includes('to="/dashboard"') &&
    invitesViewSource.includes('class="space-y-3 p-4 lg:hidden"') &&
    invitesViewSource.includes('class="hidden overflow-hidden lg:block"') &&
    invitesViewSource.includes('class="w-full table-fixed divide-y divide-themed"') &&
    invitesViewSource.includes('class="rounded-lg border border-themed bg-themed-surface p-4 shadow-sm"') &&
    invitesViewSource.includes("@click=\"copyText(invite.code, '邀请码已复制')\"") &&
    invitesViewSource.includes("@click=\"copyText(getInviteLink(invite), '邀请链接已复制')\"") &&
    invitesViewSource.includes('class="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:flex"') &&
    !invitesViewSource.includes('<div class="overflow-x-auto">') &&
    !invitesViewSource.includes('class="w-full min-w-[960px] table-fixed divide-y divide-themed"') &&
    !invitesViewSource.includes('<table class="min-w-full divide-y divide-themed"') &&
    !invitesViewSource.includes('min-w-[220px]'),
  'InvitesView must use path helpers, mobile invite cards, and a fixed-layout desktop table without PC horizontal overflow while preserving copy actions'
)
assert.ok(
  flashSalesViewSource.includes("import { instanceCreatePath } from '@/utils/app-paths'") &&
    flashSalesViewSource.includes('path: instanceCreatePath()') &&
    !flashSalesViewSource.includes("path: '/instances/create'") &&
    flashSalesViewSource.includes('class="space-y-3 p-4 lg:hidden"') &&
    flashSalesViewSource.includes('class="hidden overflow-hidden lg:block"') &&
    flashSalesViewSource.includes('class="w-full table-fixed divide-y divide-themed"') &&
    flashSalesViewSource.includes('class="rounded-lg border border-themed bg-themed-surface p-4 shadow-sm"') &&
    flashSalesViewSource.includes('flashSaleItem: String(item.id)') &&
    !flashSalesViewSource.includes('<div class="overflow-x-auto">') &&
    !flashSalesViewSource.includes('class="w-full min-w-[880px] table-fixed divide-y divide-themed"') &&
    !flashSalesViewSource.includes('<table class="min-w-full divide-y divide-themed"'),
  'FlashSalesView must route purchases through app path helpers and render mobile reservation cards plus a fixed desktop table without PC horizontal overflow'
)
const entertainmentRecordsSection = sectionBetween(
  entertainmentViewSource,
  '<!-- 抽奖记录 TAB -->',
  '<!-- 积分明细 TAB -->'
)
const entertainmentPointsSection = sectionBetween(
  entertainmentViewSource,
  '<!-- 积分明细 TAB -->',
  '<!-- 抽奖功能区域结束 -->'
)
const entertainmentPoolLogsSection = sectionBetween(
  entertainmentViewSource,
  '<!-- 签到子TAB: 记录 -->',
  '<BadgeRewardModal'
)
assert.ok(
  entertainmentRecordsSection.includes('class="space-y-3 p-4 lg:hidden"') &&
    entertainmentRecordsSection.includes('class="hidden overflow-hidden lg:block"') &&
    entertainmentRecordsSection.includes('class="w-full table-fixed"') &&
    entertainmentRecordsSection.includes('class="rounded-lg border border-themed bg-themed-surface p-4 shadow-sm"') &&
    entertainmentRecordsSection.includes('recordsPage--; loadRecords()') &&
    entertainmentRecordsSection.includes('recordsPage++; loadRecords()') &&
    !entertainmentRecordsSection.includes('class="w-full min-w-[900px] table-fixed"') &&
    !entertainmentRecordsSection.includes('v-else class="overflow-x-auto"'),
  'Entertainment lottery records must render mobile cards and a fixed-layout desktop table without PC horizontal overflow while preserving pagination'
)
assert.ok(
  entertainmentPointsSection.includes('class="space-y-3 p-4 lg:hidden"') &&
    entertainmentPointsSection.includes('class="hidden overflow-hidden lg:block"') &&
    entertainmentPointsSection.includes('class="w-full table-fixed"') &&
    entertainmentPointsSection.includes('class="rounded-lg border border-themed bg-themed-surface p-4 shadow-sm"') &&
    entertainmentPointsSection.includes('pointsLogsPage--; loadPointsLogs()') &&
    entertainmentPointsSection.includes('pointsLogsPage++; loadPointsLogs()') &&
    entertainmentPointsSection.includes('class="grid grid-cols-[1fr_auto_1fr] items-center gap-2 p-4 border-t border-themed sm:flex sm:justify-center"') &&
    !entertainmentPointsSection.includes('class="w-full min-w-[900px] table-fixed"') &&
    !entertainmentPointsSection.includes('v-else class="overflow-x-auto"'),
  'Entertainment points logs must render mobile cards and a fixed-layout desktop table without PC horizontal overflow while preserving pagination'
)
assert.ok(
  entertainmentPoolLogsSection.includes('class="space-y-3 p-4 lg:hidden"') &&
    entertainmentPoolLogsSection.includes('class="hidden overflow-hidden lg:block"') &&
    entertainmentPoolLogsSection.includes('class="w-full table-fixed"') &&
    entertainmentPoolLogsSection.includes('class="rounded-lg border border-themed bg-themed-surface p-4 shadow-sm"') &&
    entertainmentPoolLogsSection.includes('poolLogsPage--; loadPoolLogs()') &&
    entertainmentPoolLogsSection.includes('poolLogsPage++; loadPoolLogs()') &&
    entertainmentPoolLogsSection.includes('class="grid grid-cols-[1fr_auto_1fr] items-center gap-2 p-4 border-t border-themed sm:flex sm:justify-center"') &&
    !entertainmentPoolLogsSection.includes('class="w-full min-w-[900px] table-fixed"') &&
    !entertainmentPoolLogsSection.includes('v-else class="overflow-x-auto"'),
  'Entertainment resource pool logs must render mobile cards and a fixed-layout desktop table without PC horizontal overflow while preserving pagination'
)
assert.ok(
  countOccurrences(hostingWalletViewSource, 'class="w-full table-fixed"') >= 2 &&
    hostingWalletViewSource.includes('class="p-4 space-y-2 lg:hidden"') &&
    hostingWalletViewSource.includes('class="p-4 space-y-3 lg:hidden"') &&
    hostingWalletViewSource.includes('class="grid grid-cols-1 gap-3 p-4 border-t border-themed sm:grid-cols-[auto_1fr] sm:items-center"') &&
    hostingWalletViewSource.includes('class="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:flex sm:justify-center"') &&
    hostingWalletViewSource.includes('@click="loadLogs(logsPage - 1)"') &&
    hostingWalletViewSource.includes('@click="loadLogs(logsPage + 1)"') &&
    hostingWalletViewSource.includes('@click="loadWithdrawals(withdrawalsPage - 1)"') &&
    hostingWalletViewSource.includes('@click="loadWithdrawals(withdrawalsPage + 1)"') &&
    !hostingWalletViewSource.includes('class="w-full min-w-[1040px] table-fixed"') &&
    !hostingWalletViewSource.includes('class="w-full min-w-[860px] table-fixed"') &&
    !hostingWalletViewSource.includes('class="hidden md:block overflow-x-auto"') &&
    !hostingWalletViewSource.includes('class="md:hidden p-4'),
  'HostingWalletView must keep mobile wallet cards until lg and render fixed-layout desktop log/withdrawal tables without PC horizontal overflow'
)
assert.ok(
  instanceDetailViewSource.includes("import { exchangePath, helpPath, hostDetailPath, instancesPath, isAdminEntry } from '@/utils/app-paths'") &&
    instanceDetailViewSource.includes('interface CustomerSelfServiceApi') &&
    instanceDetailViewSource.includes('const customerSelfServiceApi = api as typeof api & CustomerSelfServiceApi') &&
    instanceDetailViewSource.includes('isAdminEntry ? Promise.resolve() : checkPendingTransfer()') &&
    instanceDetailViewSource.includes('if (isAdminEntry) return') &&
    instanceDetailViewSource.includes('!isAdminEntry && Boolean') &&
    instanceDetailViewSource.includes('customerSelfServiceApi.billing.setAutoRenew') &&
    instanceDetailViewSource.includes('customerSelfServiceApi.billing.getDestroyInfo') &&
    instanceDetailViewSource.includes('customerSelfServiceApi.billing.destroyInstance') &&
    instanceDetailViewSource.includes('v-if="!isAdminEntry && canTransfer') &&
    instanceDetailViewSource.includes(':enable-resource-pool="!isAdminEntry') &&
    instanceDetailViewSource.includes('v-if="!isAdminEntry && showRedeemModal"') &&
    instanceDetailViewSource.includes('v-if="!isAdminEntry && showAutoRenewModal && instance"') &&
    instanceDetailViewSource.includes('v-if="!isAdminEntry && instance"') &&
    !instanceDetailViewSource.includes('api.checkin.redeem') &&
    !instanceDetailViewSource.includes('api.transfers.list') &&
    !instanceDetailViewSource.includes('api.billing.'),
  'admin-reachable instance detail must guard customer transfer, redeem, subscription, billing-destroy, and badge self-service features'
)
assert.ok(
  instancesViewSource.includes("import { exchangePath, instanceCreatePath, instanceDetailPath, isAdminEntry, transfersPath, walletPath } from '@/utils/app-paths'") &&
    instancesViewSource.includes('interface CustomerBillingApi') &&
    instancesViewSource.includes('const customerBillingApi = api as typeof api & CustomerBillingApi') &&
    instancesViewSource.includes('const canUseCustomerBillingActions = computed<boolean>(() => !isAdminEntry && !isViewingAnotherUsersInstances.value)') &&
    instancesViewSource.includes('v-if="!isAdminEntry && showBatchRenewModal"') &&
    instancesViewSource.includes('v-if="!isAdminEntry && showBatchDestroyModal"') &&
    instancesViewSource.includes('customerBillingApi.billing.setAutoRenewBatch') &&
    instancesViewSource.includes('customerBillingApi.billing.previewBatchRenew') &&
    instancesViewSource.includes('customerBillingApi.billing.destroyInstancesBatch') &&
    instancesViewSource.includes('class="hidden overflow-hidden sm:block card"') &&
    instancesViewSource.includes('class="w-full table-fixed"') &&
    instancesViewSource.includes('@click="toggleSelectAll"') &&
    instancesViewSource.includes('@change="toggleSelect(instance.id)"') &&
    instancesViewSource.includes('@click="openInstanceDetail(instance.id)"') &&
    instancesViewSource.includes('@reorder="reorderInstance(instance, $event)"') &&
    instancesViewSource.includes("@click.stop=\"handleAction(instance, 'start')\"") &&
    instancesViewSource.includes("@click.stop=\"handleAction(instance, 'stop')\"") &&
    instancesViewSource.includes("@click.stop=\"handleAction(instance, 'restart')\"") &&
    !instancesViewSource.includes('class="hidden sm:block card overflow-x-auto"') &&
    !instancesViewSource.includes('class="w-full min-w-[1180px]"') &&
    !instancesViewSource.includes('api.billing.'),
  'admin-reachable instance list must guard customer batch renewal, auto-renew, billing destroy self-service features, and keep the desktop list free of PC horizontal overflow'
)
assert.ok(
  initCommandSelectorSource.includes("import { extensionsPath } from '@/utils/app-paths'") &&
    initCommandSelectorSource.includes('const manageExtensionsPath = extensionsPath()') &&
    initCommandSelectorSource.includes('v-if="manageExtensionsPath"') &&
    initCommandSelectorSource.includes(':to="manageExtensionsPath"') &&
    !initCommandSelectorSource.includes('to="/extensions"') &&
    viteConfigSource.includes('TransferModalAdminStub.vue') &&
    viteConfigSource.includes('RenewModalAdminStub.vue') &&
    viteConfigSource.includes('ApplyAffCodeModalAdminStub.vue') &&
    viteConfigSource.includes('ChangePlanModalAdminStub.vue') &&
    viteConfigSource.includes('DestroyInstanceModalAdminStub.vue') &&
    viteConfigSource.includes('InstanceBadgeModalAdminStub.vue') &&
    viteConfigSource.includes("find: /^@\\/components\\/instance\\/modals\\/TransferModal\\.vue$/") &&
    viteConfigSource.includes("find: /^@\\/components\\/instance\\/modals\\/RenewModal\\.vue$/") &&
    viteConfigSource.includes("find: /^@\\/components\\/instance\\/InstanceBadgeModal\\.vue$/"),
  'admin builds must alias user-only transfer, billing, badge, and extension-management links out of admin-reachable shared components'
)
assert.ok(
  inboxHelperSource.includes('instanceDetailPath(String(data.instanceId))') &&
    inboxHelperSource.includes('isAdminEntry ? null : transfersPath()') &&
    inboxHelperSource.includes('isAdminEntry ? null : dashboardPath()') &&
    !inboxHelperSource.includes('return `/instances/${data.instanceId}`') &&
    !inboxHelperSource.includes("return '/transfers'") &&
    !inboxHelperSource.includes("return '/dashboard'") &&
    notificationBellSource.includes("import { inboxPath } from '@/utils/app-paths'") &&
    notificationBellSource.includes('router.push(inboxPath())') &&
    !notificationBellSource.includes("router.push('/inbox')"),
  'shared inbox notification routing must use app path helpers and avoid customer-only paths in the admin entry'
)
assert.ok(
  mailViewSource.includes("import { mailDomainPath } from '@/utils/app-paths'") &&
    mailViewSource.includes('router.push(mailDomainPath(id))') &&
    !mailViewSource.includes('router.push(`/mail/domains/${id}`)') &&
    mailDomainViewSource.includes("import { helpPath, mailPath } from '@/utils/app-paths'") &&
    mailDomainViewSource.includes('router.push(mailPath())') &&
    mailDomainViewSource.includes(':to="`${helpPath()}/mail`"') &&
    !mailDomainViewSource.includes("router.push('/mail')") &&
    !mailDomainViewSource.includes('to="/help/mail"'),
  'mail views must route through app path helpers so customer mail links do not leak into the admin build'
)
assert.ok(
  marketViewSource.includes("import { instanceCreatePath, loginPath } from '@/utils/app-paths'") &&
    marketViewSource.includes('path: instanceCreatePath()') &&
    marketViewSource.includes('const redirect = `${instanceCreatePath()}?${new URLSearchParams(query).toString()}`') &&
    marketViewSource.includes('path: loginPath()') &&
    marketViewSource.includes("query: { redirect }") &&
    !marketViewSource.includes("path: '/instances/create'") &&
    !marketViewSource.includes("path: '/login'") &&
    dashboardViewSource.includes("import { entertainmentPath, instanceCreatePath, instanceDetailPath, instancesPath } from '@/utils/app-paths'") &&
    dashboardViewSource.includes(':to="instanceCreatePath()"') &&
    dashboardViewSource.includes(':to="instancesPath()"') &&
    dashboardViewSource.includes(':to="instanceDetailPath(instance.id)"') &&
    dashboardViewSource.includes(':to="{ path: entertainmentPath(), query: { tab: \'checkin\' } }"') &&
    !dashboardViewSource.includes('to="/instances/create"') &&
    !dashboardViewSource.includes('to="/instances"') &&
    !dashboardViewSource.includes('to="/checkin"') &&
    !dashboardViewSource.includes(':to="`/instances/${instance.id}`"'),
  'MarketView CTA must send authenticated users to instance creation and guests through login with a redirect'
)
assert.ok(
  adminHelpManageViewSource.includes('class="card overflow-hidden"') &&
    adminHelpManageViewSource.includes('class="space-y-3 p-4 lg:hidden"') &&
    adminHelpManageViewSource.includes('class="hidden overflow-hidden lg:block"') &&
    adminHelpManageViewSource.includes('table class="w-full table-fixed"') &&
    adminHelpManageViewSource.includes('@click="openEdit(article)"') &&
    adminHelpManageViewSource.includes('@click="togglePublished(article)"') &&
    adminHelpManageViewSource.includes('@click="deleteArticle(article)"') &&
    !adminHelpManageViewSource.includes('class="card overflow-x-auto"') &&
    !adminHelpManageViewSource.includes('table class="w-full min-w-[800px]"'),
  'admin help article list must keep mobile cards, a fixed desktop table, and edit/publish/delete actions'
)
assert.ok(
  countOccurrences(adminMailViewSource, 'class="space-y-3 lg:hidden"') >= 4 &&
    countOccurrences(adminMailViewSource, 'class="card hidden overflow-hidden lg:block"') >= 4 &&
    adminMailViewSource.includes('table class="w-full table-fixed"') &&
    adminMailViewSource.includes('table class="w-full table-fixed"') &&
    adminMailViewSource.includes('table class="w-full table-fixed"') &&
    adminMailViewSource.includes('table class="w-full table-fixed"') &&
    adminMailViewSource.includes('@click="openEditSourceModal(source)"') &&
    adminMailViewSource.includes('@click="deleteSource(source)"') &&
    adminMailViewSource.includes('@click="openEditPlanModal(plan)"') &&
    adminMailViewSource.includes('@click="deletePlan(plan)"') &&
    adminMailViewSource.includes('@click="openUnsubModal(sub)"') &&
    !adminMailViewSource.includes('class="card overflow-x-auto"') &&
    !adminMailViewSource.includes('table-auto w-full min-w-[640px]') &&
    !adminMailViewSource.includes('table-auto w-full min-w-[800px]'),
  'admin mail lists must render mobile cards and fixed desktop tables while preserving edit/delete/unsubscribe actions'
)
assert.ok(
  adminImagesViewSource.includes('class="space-y-3 lg:hidden"') &&
    adminImagesViewSource.includes('class="card hidden overflow-hidden lg:block"') &&
    adminImagesViewSource.includes('table class="w-full table-fixed"') &&
    adminImagesViewSource.includes('@click="toggleHidden(image)"') &&
    adminImagesViewSource.includes('@click="openEditModal(image)"') &&
    adminImagesViewSource.includes('@click="deleteImage(image)"') &&
    adminImagesViewSource.includes('v-if="filteredImages.length === 0"') &&
    !adminImagesViewSource.includes('class="card overflow-x-auto"') &&
    !adminImagesViewSource.includes('table-auto w-full min-w-[640px]'),
  'admin image list must render mobile cards and a fixed desktop table while preserving visibility/edit/delete actions'
)
assert.ok(
  countOccurrences(adminPluginCenterViewSource, 'table class="w-full table-fixed text-sm"') >= 5 &&
    adminPluginCenterViewSource.includes('@click="uploadPlugin"') &&
    adminPluginCenterViewSource.includes('@click="togglePlugin(plugin)"') &&
    adminPluginCenterViewSource.includes('@click="scanThemeSubmission(submission)"') &&
    adminPluginCenterViewSource.includes("@click=\"reviewThemeSubmission(submission, 'listed')\"") &&
    adminPluginCenterViewSource.includes("@click=\"reviewCapability(review, 'approved')\"") &&
    adminPluginCenterViewSource.includes('@click="saveActionRateLimits"') &&
    adminPluginCenterViewSource.includes('@click="retryDueEvents"') &&
    adminPluginCenterViewSource.includes('@click="replayPluginEvent(event)"') &&
    !adminPluginCenterViewSource.includes('class="overflow-x-auto"') &&
    !adminPluginCenterViewSource.includes('class="mt-4 overflow-x-auto"') &&
    !adminPluginCenterViewSource.includes('class="min-w-full'),
  'admin plugin center tables must use fixed layouts without horizontal overflow while preserving upload, review, capability, rate-limit, retry, and replay actions'
)

console.log('frontend route guard tests passed')
