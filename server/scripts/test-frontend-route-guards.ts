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

const userRouterSource = readRepoFile('client/src/router/user.ts')
const adminRouterSource = readRepoFile('client/src/router/admin.ts')
const appSource = readRepoFile('client/src/App.vue')
const adminAppSource = readRepoFile('client/src/admin/AdminApp.vue')
const authStoreSource = readRepoFile('client/src/stores/auth.ts')
const appLayoutSource = readRepoFile('client/src/components/layout/AppLayout.vue')
const notificationBellSource = readRepoFile('client/src/components/NotificationBell.vue')
const adminMainSource = readRepoFile('client/src/admin/main.ts')
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
const instancesViewSource = readRepoFile('client/src/views/InstancesView.vue')
const instanceDetailViewSource = readRepoFile('client/src/views/InstanceDetailView.vue')
const ticketsViewSource = readRepoFile('client/src/views/TicketsView.vue')
const renewModalSource = readRepoFile('client/src/components/instance/modals/RenewModal.vue')
const changePlanModalSource = readRepoFile('client/src/components/instance/modals/ChangePlanModal.vue')
const initCommandSelectorSource = readRepoFile('client/src/components/extensions/InitCommandSelector.vue')
const hostInstancesTabSource = readRepoFile('client/src/components/host/HostInstancesTab.vue')
const hostCreateInstanceTabSource = readRepoFile('client/src/components/host/HostCreateInstanceTab.vue')
const ticketInstanceOwnerCardSource = readRepoFile('client/src/components/tickets/TicketInstanceOwnerCard.vue')
const myHostsViewSource = readRepoFile('client/src/views/resources/MyHostsView.vue')
const myPackagesViewSource = readRepoFile('client/src/views/resources/MyPackagesView.vue')
const inboxHelperSource = readRepoFile('client/src/utils/inboxHelper.ts')
const marketViewSource = readRepoFile('client/src/views/MarketView.vue')
const portalViewSource = readRepoFile('client/src/views/PortalView.vue')
const loginViewSource = readRepoFile('client/src/views/LoginView.vue')
const adminLoginViewSource = readRepoFile('client/src/views/admin/AdminLoginView.vue')
const registerViewSource = readRepoFile('client/src/views/RegisterView.vue')
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
    !userRouterSource.includes('@/views/admin/PluginCenterView.vue'),
  'plugin center must keep admin management under /admin/plugins while exposing only user plugin pages in the customer router'
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
  publicHeaderSource.includes("to: '/'") &&
    publicHeaderSource.includes("to: '/market'") &&
    publicFooterSource.includes("{ to: '/', label: t('publicSite.nav.overview') }") &&
    publicFooterSource.includes("to: '/market'") &&
    portalViewSource.includes("name: 'PortalView'") &&
    marketViewSource.includes("name: 'MarketView'"),
  'public navigation links to / and /market must land on the real public views'
)
assert.ok(
  portalViewSource.includes("path: '/market'") &&
    !portalViewSource.includes('openAdminConsole') &&
    portalViewSource.includes("void router.push('/dashboard')") &&
    portalViewSource.includes("void router.push('/login')"),
  'PortalView CTA must browse the public market and keep authenticated users on the customer console or guests on customer login'
)
assert.ok(
  !userRouterSource.includes('openAdminLogin') &&
    userRouterSource.includes("next({ name: 'login', query: { adminOnly: '1' } })") &&
    userRouterSource.includes('if ((to.meta.requiresAuth || to.meta.requiresUser) && authStore.isAdmin)') &&
    !loginViewSource.includes('isAdminEntry') &&
    !loginViewSource.includes('后台管理系统') &&
    !loginViewSource.includes('/admin/users') &&
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
  adminEndpointMarkers.filter(marker => userApiSource.includes(marker)),
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
    registerViewSource.includes('api.auth.register') &&
    registerViewSource.includes('authStore.syncToken()') &&
    registerViewSource.includes('authStore.fetchCurrentUser()'),
  'shared auth store must not expose customer registration; registration belongs only to RegisterView in the customer entry'
)
assert.ok(
  adminUsersViewSource.includes('import.meta.env.VITE_CUSTOMER_BASE_URL') &&
    adminUsersViewSource.includes('window.location.origin') &&
    adminUsersViewSource.includes('return `${customerBaseUrl.value}/register/${newInviteCode.value}`') &&
    !adminUsersViewSource.includes('return `${window.location.origin}/register/${newInviteCode.value}`'),
  'admin generated invite links must point to the configured customer frontend origin, not the admin origin'
)
assert.ok(
  appSource.includes("import PublicSiteLayout from '@/components/public/PublicSiteLayout.vue'") &&
    appSource.includes("const publicSiteRouteNames = new Set(['portal', 'market', 'help', 'help-article'])") &&
    appSource.includes('const showPublicSiteLayout = computed<boolean>') &&
    appSource.includes('!showPublicSiteLayout.value') &&
    appSource.includes('<PublicSiteLayout v-else-if="showPublicSiteLayout">'),
  'App shell must wrap public portal, market, and help routes with the public site header/footer layout'
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
    !sideNavSource.includes("return route.path === '/dashboard'") &&
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
    userAppPathsSource.includes("return '/resources/hosts'") &&
    userAppPathsSource.includes("return '/resources/packages'") &&
    userAppPathsSource.includes("return '/wallet'") &&
    userAppPathsSource.includes("return '/help'") &&
    userAppPathsSource.includes("return '/inbox'") &&
    userAppPathsSource.includes("return '/terminal'") &&
    userAppPathsSource.includes("return '/extensions'") &&
    userAppPathsSource.includes("return '/instances'") &&
    userAppPathsSource.includes("return '/instances/create'") &&
    adminAppPathsSource.includes("return '/admin/login'") &&
    adminAppPathsSource.includes("return '/admin/profile'") &&
    adminAppPathsSource.includes("return '/admin/billing'") &&
    adminAppPathsSource.includes("return '/admin/help'") &&
    adminAppPathsSource.includes("return '/admin/inbox'") &&
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
    hostCreateInstanceTabSource.includes('instanceDetailPath(result.id)') &&
    ticketInstanceOwnerCardSource.includes('instanceDetailPath(props.instanceSummary.id)') &&
    myPackagesViewSource.includes("import { instanceCreatePath, isAdminEntry, packageCreatePath, packageEditPath } from '@/utils/app-paths'") &&
    myPackagesViewSource.includes('if (isAdminEntry) return') &&
    myPackagesViewSource.includes('${window.location.origin}${instanceCreatePath()}?source=${source}&package=${pkg.id}') &&
    myPackagesViewSource.includes('v-if="!isAdminEntry"'),
  'admin-reachable shared instance pages must use app path helpers instead of hardcoded customer /instances paths'
)
assert.ok(
  instancesViewSource.includes('walletPath()') &&
    !instancesViewSource.includes('to="/wallet"') &&
    instanceDetailViewSource.includes('helpPath()') &&
    !instanceDetailViewSource.includes('to="/help"') &&
    ticketsViewSource.includes("import { ticketsPath } from '@/utils/app-paths'") &&
    ticketsViewSource.includes('path: ticketsPath()') &&
    !ticketsViewSource.includes("name: 'tickets'") &&
    renewModalSource.includes('walletPath()') &&
    !renewModalSource.includes('href="/wallet"') &&
    changePlanModalSource.includes('walletPath()') &&
    !changePlanModalSource.includes('href="/wallet"'),
  'admin-reachable shared pages must not hardcode customer-only wallet/help/ticket routes'
)
assert.ok(
  instanceDetailViewSource.includes("import { helpPath, hostDetailPath, instancesPath, isAdminEntry } from '@/utils/app-paths'") &&
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
  instancesViewSource.includes("import { instanceCreatePath, instanceDetailPath, isAdminEntry, transfersPath, walletPath } from '@/utils/app-paths'") &&
    instancesViewSource.includes('interface CustomerBillingApi') &&
    instancesViewSource.includes('const customerBillingApi = api as typeof api & CustomerBillingApi') &&
    instancesViewSource.includes('const canUseCustomerBillingActions = computed<boolean>(() => !isAdminEntry && !isViewingAnotherUsersInstances.value)') &&
    instancesViewSource.includes('v-if="!isAdminEntry && showBatchRenewModal"') &&
    instancesViewSource.includes('v-if="!isAdminEntry && showBatchDestroyModal"') &&
    instancesViewSource.includes('customerBillingApi.billing.setAutoRenewBatch') &&
    instancesViewSource.includes('customerBillingApi.billing.previewBatchRenew') &&
    instancesViewSource.includes('customerBillingApi.billing.destroyInstancesBatch') &&
    !instancesViewSource.includes('api.billing.'),
  'admin-reachable instance list must guard customer batch renewal, auto-renew, and billing destroy self-service features'
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
  marketViewSource.includes("void router.push({\n      path: '/instances/create'") &&
    marketViewSource.includes("path: '/login'") &&
    marketViewSource.includes("query: { redirect }"),
  'MarketView CTA must send authenticated users to instance creation and guests through login with a redirect'
)

console.log('frontend route guard tests passed')
