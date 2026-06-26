import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseThemeManifest } from '../src/lib/theme-package.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

const schema = read('server/prisma/schema.prisma')
const migration = read('server/prisma/migrations/20260626113000_add_theme_packages/migration.sql')
const configMigration = read('server/prisma/migrations/20260626143000_add_theme_config_values/migration.sql')
const themeSubmissionMigration = read('server/prisma/migrations/20260626162000_add_theme_market_submissions/migration.sql')
const themePackage = read('server/src/lib/theme-package.ts')
const themeMarket = read('server/src/lib/theme-market.ts')
const runtimeSettings = read('server/src/lib/runtime-settings.ts')
const themeMarketSubmissionsDb = read('server/src/db/theme-market-submissions.ts')
const themeMarketSubmissionScanner = read('server/src/lib/theme-market-submission-scan.ts')
const themeMarketPublisher = read('server/src/lib/theme-market-publisher.ts')
const themesDb = read('server/src/db/themes.ts')
const themeRoutes = read('server/src/routes/themes.ts')
const adminThemeRoutes = read('server/src/routes/admin-themes.ts')
const themeMarketSubmissionRoutes = read('server/src/routes/theme-market-submissions.ts')
const app = read('server/src/app.ts')
const themeStore = read('client/src/stores/theme.ts')
const themeTemplateSlot = read('client/src/components/theme/ThemeTemplateSlot.vue')
const sideNav = read('client/src/components/layout/SideNav.vue')
const dashboardView = read('client/src/views/DashboardView.vue')
const instanceDetailView = read('client/src/views/InstanceDetailView.vue')
const walletView = read('client/src/views/WalletView.vue')
const ticketsView = read('client/src/views/TicketsView.vue')
const adminStatisticsView = read('client/src/views/admin/StatisticsView.vue')
const portalView = read('client/src/views/PortalView.vue')
const marketView = read('client/src/views/MarketView.vue')
const extensionsView = read('client/src/views/ExtensionsView.vue')
const ordersView = read('client/src/views/OrdersView.vue')
const profileView = read('client/src/views/ProfileView.vue')
const invitesView = read('client/src/views/InvitesView.vue')
const myHostsView = read('client/src/views/resources/MyHostsView.vue')
const myHostCreateView = read('client/src/views/resources/MyHostCreateView.vue')
const publicSiteFooter = read('client/src/components/public/PublicSiteFooter.vue')
const loginView = read('client/src/views/LoginView.vue')
const registerView = read('client/src/views/RegisterView.vue')
const forgotPasswordView = read('client/src/views/ForgotPasswordView.vue')
const adminApi = read('client/src/api/admin.ts')
const userApi = read('client/src/api/index.ts')
const apiTypes = read('client/src/types/api.ts')
const pluginCenter = read('client/src/views/admin/PluginCenterView.vue')
const envExample = read('.env.example')
const installPanel = read('scripts/install-panel.sh')
const readme = read('README.md')
const serverPackage = read('server/package.json')
const rootPackage = read('package.json')
const developmentDocs = read('docs-site/docs/plugins/development.md')
const enOverviewDocs = read('docs-site/docs/en/plugins/overview.md')
const platformPlan = read('docs-site/docs/plugins/platform-plan.md')
const themeMarketIndex = read('docs-site/docs/public/theme-market/index.json')
const parsedThemeMarketIndex = JSON.parse(themeMarketIndex) as {
  themes?: Array<{ id: string; latest: string; manifestUrl: string; downloadUrl: string; sha256: string; reviewStatus: string }>
}
const cleanThemeManifestSource = read('theme-templates/clean-theme/payincus.theme.json')
const cleanThemeManifest = parseThemeManifest(JSON.parse(cleanThemeManifestSource))
const cleanThemeCss = read('theme-templates/clean-theme/dist/theme.css')
const cleanThemeReadme = read('theme-templates/clean-theme/README.md')
const cleanThemeUsage = read('theme-templates/clean-theme/docs/usage.md')
const cleanThemeTokens = read('theme-templates/clean-theme/tokens/colors.json')
const cleanThemeHomeHero = read('theme-templates/clean-theme/templates/public/home-hero.html')
const cleanThemeHomeSections = read('theme-templates/clean-theme/templates/public/home-sections.html')
const cleanThemeMarketBanner = read('theme-templates/clean-theme/templates/public/market-banner.html')
const cleanThemeAuthAside = read('theme-templates/clean-theme/templates/public/auth-aside.html')
const cleanThemeUserShellBrand = read('theme-templates/clean-theme/templates/user/shell-brand.html')
const cleanThemeUserBanner = read('theme-templates/clean-theme/templates/user/dashboard-banner.html')
const cleanThemeUserCards = read('theme-templates/clean-theme/templates/user/dashboard-cards.html')
const cleanThemeInstanceDetailExtra = read('theme-templates/clean-theme/templates/user/instance-detail-extra.html')
const cleanThemeWalletBanner = read('theme-templates/clean-theme/templates/user/wallet-banner.html')
const cleanThemeTicketsBanner = read('theme-templates/clean-theme/templates/user/tickets-banner.html')
const cleanThemeExtensionsBanner = read('theme-templates/clean-theme/templates/user/extensions-banner.html')
const cleanThemeOrdersBanner = read('theme-templates/clean-theme/templates/user/orders-banner.html')
const cleanThemeProfileBanner = read('theme-templates/clean-theme/templates/user/profile-banner.html')
const cleanThemeInvitesBanner = read('theme-templates/clean-theme/templates/user/invites-banner.html')
const cleanThemeHostsBanner = read('theme-templates/clean-theme/templates/user/hosts-banner.html')
const cleanThemeHostCreateBanner = read('theme-templates/clean-theme/templates/user/host-create-banner.html')
const cleanThemeAdminShellBrand = read('theme-templates/clean-theme/templates/admin/shell-brand.html')
const cleanThemeAdminExtensionsHeader = read('theme-templates/clean-theme/templates/admin/extensions-header.html')
const cleanThemeAdminExtensionsMarketBanner = read('theme-templates/clean-theme/templates/admin/extensions-market-banner.html')
const cleanThemeAdminExtensionsThemeBanner = read('theme-templates/clean-theme/templates/admin/extensions-theme-banner.html')
const cleanThemeAdminBanner = read('theme-templates/clean-theme/templates/admin/dashboard-banner.html')
const cleanThemeAdminWidgets = read('theme-templates/clean-theme/templates/admin/dashboard-widgets.html')
const cleanThemeAdminBillingBanner = read('theme-templates/clean-theme/templates/admin/billing-banner.html')
const cleanThemeAdminPaymentProvidersBanner = read('theme-templates/clean-theme/templates/admin/payment-providers-banner.html')
const cleanThemeAdminOAuthBanner = read('theme-templates/clean-theme/templates/admin/oauth-banner.html')
const cleanThemeFooter = read('theme-templates/clean-theme/templates/public/footer.html')
const templatesDocs = read('docs-site/docs/plugins/templates.md')

assert(
    schema.includes('model ThemePackage') &&
    schema.includes('themesInstalled ThemePackage[] @relation("ThemeInstaller")') &&
    schema.includes('themesEnabled ThemePackage[] @relation("ThemeEnabler")') &&
    schema.includes('model ThemeMarketSubmission') &&
    schema.includes('themeMarketSubmissions ThemeMarketSubmission[] @relation("ThemeMarketSubmissionSubmitter")') &&
    schema.includes('themeMarketReviews ThemeMarketSubmission[] @relation("ThemeMarketSubmissionReviewer")') &&
    schema.includes('configValues      Json') &&
    migration.includes('CREATE TABLE "theme_packages"') &&
    migration.includes('CREATE UNIQUE INDEX "theme_packages_theme_id_key"') &&
    configMigration.includes('ADD COLUMN "config_values" JSONB NOT NULL DEFAULT') &&
    themeSubmissionMigration.includes('CREATE TABLE "theme_market_submissions"') &&
    themeSubmissionMigration.includes('theme_market_submissions_theme_id_version_key'),
  'theme schema and migrations must create theme_packages, user relations, and persisted config values'
)

assert(
  themePackage.includes('payincus.theme.json') &&
    themePackage.includes('parseThemeManifest') &&
    themePackage.includes('Theme manifest cannot declare scripts') &&
    themePackage.includes('Theme package cannot contain executable or script file') &&
    themePackage.includes('Theme CSS cannot import remote stylesheets') &&
    themePackage.includes('THEME_TEMPLATE_SLOTS') &&
    themePackage.includes("'public.market.banner'") &&
    themePackage.includes("'user.wallet.banner'") &&
    themePackage.includes("'user.tickets.banner'") &&
    themePackage.includes("'user.extensions.banner'") &&
    themePackage.includes("'user.orders.banner'") &&
    themePackage.includes("'user.profile.banner'") &&
    themePackage.includes("'user.invites.banner'") &&
    themePackage.includes("'user.hosts.banner'") &&
    themePackage.includes("'user.host.create.banner'") &&
    themePackage.includes("'admin.extensions.header'") &&
    themePackage.includes("'admin.extensions.market.banner'") &&
    themePackage.includes("'admin.extensions.theme.banner'") &&
    themePackage.includes("'admin.billing.banner'") &&
    themePackage.includes("'admin.payment.providers.banner'") &&
    themePackage.includes("'admin.oauth.banner'") &&
    themePackage.includes('normalizeThemeTemplates') &&
    themePackage.includes('export function getThemeDataDir') &&
    themePackage.includes('assertSafeThemeTemplateHtml') &&
    themePackage.includes('contains a blocked element') &&
    themePackage.includes('contains inline event handlers') &&
    themePackage.includes('THEME_CONFIG_FIELD_TYPES') &&
    themePackage.includes('group: sanitizeString(rawField.group, 80)') &&
    themePackage.includes('order: typeof rawField.order ===') &&
    themePackage.includes('must be an uploaded theme config file URL') &&
    themePackage.includes('normalizeThemeConfigValues') &&
    themePackage.includes('THEME_INSTALL_DIR') &&
    themePackage.includes('THEME_STAGING_DIR') &&
    themePackage.includes('THEME_MAX_PACKAGE_SIZE_MB'),
  'theme package validation must enforce manifest, safe paths, no scripts, no remote CSS imports, and runtime dirs'
)

assert(
  themeMarket.includes('export async function fetchThemeMarketIndex') &&
    themeMarket.includes('getThemeMarketIndexUrl as getConfiguredThemeMarketIndexUrl') &&
    themeMarket.includes('getThemeMarketTrustedHosts') &&
    runtimeSettings.includes("'theme_market_index_url'") &&
    runtimeSettings.includes('THEME_MARKET_INDEX_URL') &&
    runtimeSettings.includes("'theme_market_trusted_hosts'") &&
    runtimeSettings.includes('THEME_MARKET_TRUSTED_HOSTS') &&
    themeMarket.includes('/theme-market/index.json') &&
    themeMarket.includes('/theme-market/packages/') &&
    themeMarket.includes("entry.reviewStatus !== 'listed'") &&
    themeMarket.includes('Theme market entry must pin a SHA256 checksum') &&
    themeMarket.includes('Theme package SHA256 mismatch') &&
    themeMarket.includes('getCurrentVersionMetadata') &&
    themeMarket.includes('theme package validation required'),
  'theme market runtime must read a stable online index, trust only allowed hosts, require listed entries, pin SHA256, and enforce compatibility before install'
)

assert(
  themeMarketSubmissionsDb.includes('createThemeMarketSubmission') &&
    themeMarketSubmissionsDb.includes('reviewThemeMarketSubmission') &&
    themeMarketSubmissionsDb.includes('updateThemeMarketSubmissionScan') &&
    themeMarketSubmissionScanner.includes('scanThemeMarketSubmission') &&
    themeMarketSubmissionScanner.includes('validateAndExtractThemePackage') &&
    themeMarketSubmissionScanner.includes('Theme package URL') &&
    themeMarketSubmissionScanner.includes('sha256_mismatch') &&
    themeMarketPublisher.includes('publishThemeMarketIndex') &&
    themeMarketPublisher.includes('THEME_MARKET_PUBLISH_DIR') &&
    themeMarketPublisher.includes('THEME_MARKET_PUBLIC_BASE_URL') &&
    themeMarketPublisher.includes("scanStatus: { in: ['passed', 'warning'] }") &&
    themeMarketPublisher.includes('entriesById.set(submission.themeId, submissionToMarketEntry(submission, publicBaseUrl))'),
  'theme submissions must persist review state, scan theme packages safely, and publish listed scanned themes into the theme market index'
)

assert(
  themesDb.includes('installValidatedTheme') &&
    themesDb.includes('enableThemePackage') &&
    themesDb.includes('rollbackDefaultTheme') &&
    themesDb.includes('updateThemePackageConfig') &&
    themesDb.includes('configValues') &&
    themesDb.includes('templateUrls') &&
    themesDb.includes('buildThemeTemplateUrls') &&
    themesDb.includes('updateMany') &&
    themesDb.includes("status: 'enabled'") &&
    themesDb.includes('serializeThemePackage'),
  'theme db layer must install themes, serialize URLs, enable one active theme, and support default rollback'
)

assert(
    adminThemeRoutes.includes("fastify.post('/upload'") &&
    adminThemeRoutes.includes('/:themeId/config-files/:key') &&
    adminThemeRoutes.includes('THEME_CONFIG_FILE_FIELD_REQUIRED') &&
    adminThemeRoutes.includes('Theme config file must be a PNG, JPEG, or WebP image') &&
    adminThemeRoutes.includes('theme.config_file.upload') &&
    adminThemeRoutes.includes("fastify.get('/market'") &&
    adminThemeRoutes.includes("fastify.post<{ Body: ThemeMarketInstallBody }>('/market/install'") &&
    adminThemeRoutes.includes('fetchThemeMarketIndex') &&
    adminThemeRoutes.includes('downloadMarketTheme') &&
    adminThemeRoutes.includes('THEME_MARKET_MANIFEST_MISMATCH') &&
    adminThemeRoutes.includes('theme.market_install') &&
    adminThemeRoutes.includes("fastify.post<{ Params: ThemeParams }>('/:themeId/enable'") &&
    adminThemeRoutes.includes("fastify.put<{ Params: ThemeParams; Body: ThemeConfigBody }>('/:themeId/config'") &&
    adminThemeRoutes.includes('theme.config_update') &&
    adminThemeRoutes.includes('themeConfigAuditSummary') &&
    adminThemeRoutes.includes('added=[${summarizeConfigKeys(addedKeys)}]') &&
    adminThemeRoutes.includes('updated=[${summarizeConfigKeys(updatedKeys)}]') &&
    adminThemeRoutes.includes('removed=[${summarizeConfigKeys(removedKeys)}]') &&
    adminThemeRoutes.includes('secret=[${summarizeConfigKeys(secretKeys)}]') &&
    adminThemeRoutes.includes('file=[${summarizeConfigKeys(fileKeys)}]') &&
    adminThemeRoutes.includes('values=redacted') &&
    !adminThemeRoutes.includes('JSON.stringify(configValues)') &&
    adminThemeRoutes.includes("fastify.post('/default'") &&
    adminThemeRoutes.includes("fastify.delete<{ Params: ThemeParams }>('/:themeId'") &&
    adminThemeRoutes.includes('THEME_MANAGER_ALLOWED_ADMIN_IDS') &&
    adminThemeRoutes.includes('Super administrator privileges required'),
  'admin theme routes must expose upload, enable, rollback, uninstall, and super-admin gating'
)

assert(
  themeRoutes.includes("fastify.get('/active'") &&
    themeRoutes.includes('/:themeId/config-files/:key/:filename') &&
    themeRoutes.includes('THEME_CONFIG_FILE_NOT_FOUND') &&
    themeRoutes.includes("field.type !== 'file'") &&
    themeRoutes.includes('configValues[key] !== expectedValue') &&
    themeRoutes.includes("fastify.get<{ Params: { themeId: string } }>('/preview/:themeId'") &&
    themeRoutes.includes("fastify.get('/assets/:themeId/:version/*'") &&
    themeRoutes.includes('X-Content-Type-Options') &&
    app.includes("adminThemeRoutes from './routes/admin-themes.js'") &&
    app.includes("themeRoutes from './routes/themes.js'") &&
    app.includes("themeMarketSubmissionRoutes from './routes/theme-market-submissions.js'") &&
    app.includes("prefix: '/api/admin/themes'") &&
    app.includes("prefix: '/api/themes'"),
  'theme public/admin routes must be registered with active theme, preview, and asset endpoints'
)

assert(
  themeMarketSubmissionRoutes.includes("fastify.post<{ Body: SubmissionBody }>('/'") &&
    themeMarketSubmissionRoutes.includes("fastify.get('/mine'") &&
    themeMarketSubmissionRoutes.includes("fastify.get<{ Querystring: SubmissionQuery }>('/admin'") &&
    themeMarketSubmissionRoutes.includes("fastify.post<{ Params: ReviewParams }>('/admin/:id/scan'") &&
    themeMarketSubmissionRoutes.includes("fastify.post('/admin/publish-market-index'") &&
    themeMarketSubmissionRoutes.includes('requireThemeMarketReviewer') &&
    themeMarketSubmissionRoutes.includes('theme.market_submission.scan') &&
    app.includes("prefix: '/api/theme-market-submissions'"),
  'theme market submission routes must expose developer submission, reviewer queue, scan, review, and publish endpoints'
)

assert(
    apiTypes.includes('export interface ThemePackageRecord') &&
    apiTypes.includes('export interface ThemeMarketEntry') &&
    apiTypes.includes('export interface ThemeMarketGovernance') &&
    apiTypes.includes('export interface ThemeMarketSubmission') &&
    apiTypes.includes('export interface ThemeMarketSubmissionScanResult') &&
    apiTypes.includes('export interface PayIncusThemeConfigField') &&
    apiTypes.includes('group?: string') &&
    apiTypes.includes('order?: number') &&
    apiTypes.includes('export interface PayIncusThemeTemplate') &&
    apiTypes.includes('configValues: Record<string, unknown>') &&
    apiTypes.includes('templateUrls: Record<string, { title: string; url: string }>') &&
    adminApi.includes('themes:') &&
    adminApi.includes('market: (): Promise<{ themes: ThemeMarketEntry[]; governance: ThemeMarketGovernance }>') &&
    adminApi.includes("http.get('/admin/themes/market'") &&
    adminApi.includes('installMarket:') &&
    adminApi.includes("http.post('/admin/themes/market/install'") &&
    adminApi.includes('themeMarketSubmissions:') &&
    adminApi.includes("http.post('/theme-market-submissions/admin/publish-market-index'") &&
    adminApi.includes("http.post('/admin/themes/upload'") &&
    adminApi.includes('uploadConfigFile: (themeId: string, key: string, file: File)') &&
    adminApi.includes('/config-files/') &&
    adminApi.includes('updateConfig:') &&
    adminApi.includes("http.put(`/admin/themes/${themeId}/config`") &&
    userApi.includes('getActive: (): Promise<{ theme: ThemePackageRecord | null }>') &&
    themeStore.includes('ACTIVE_THEME_LINK_ID') &&
    themeStore.includes("fetch(buildApiUrl('/themes/active')") &&
    themeStore.includes('loadActiveTheme') &&
    themeStore.includes('activeThemeTemplateUrls') &&
    themeStore.includes('getActiveThemeTemplateUrl') &&
    themeTemplateSlot.includes('themeStore.getActiveThemeTemplateUrl(props.slotName)') &&
    themeTemplateSlot.includes("credentials: 'include'") &&
    themeTemplateSlot.includes('v-html="html"') &&
    themeTemplateSlot.includes('data-theme-slot') &&
    sideNav.includes('ThemeTemplateSlot') &&
    sideNav.includes("'admin.shell.brand'") &&
    sideNav.includes("'user.shell.brand'") &&
    dashboardView.includes('ThemeTemplateSlot') &&
    dashboardView.includes('slot-name="user.dashboard.banner"') &&
    dashboardView.includes('slot-name="user.dashboard.cards"') &&
    instanceDetailView.includes('ThemeTemplateSlot') &&
    instanceDetailView.includes('slot-name="user.instance.detail.extra"') &&
    walletView.includes('ThemeTemplateSlot') &&
    walletView.includes('slot-name="user.wallet.banner"') &&
    ticketsView.includes('ThemeTemplateSlot') &&
    ticketsView.includes('slot-name="user.tickets.banner"') &&
    extensionsView.includes('ThemeTemplateSlot') &&
    extensionsView.includes('slot-name="user.extensions.banner"') &&
    ordersView.includes('ThemeTemplateSlot') &&
    ordersView.includes('slot-name="user.orders.banner"') &&
    profileView.includes('ThemeTemplateSlot') &&
    profileView.includes('slot-name="user.profile.banner"') &&
    invitesView.includes('ThemeTemplateSlot') &&
    invitesView.includes('slot-name="user.invites.banner"') &&
    myHostsView.includes('ThemeTemplateSlot') &&
    myHostsView.includes('slot-name="user.hosts.banner"') &&
    myHostCreateView.includes('ThemeTemplateSlot') &&
    myHostCreateView.includes('slot-name="user.host.create.banner"') &&
    adminStatisticsView.includes('ThemeTemplateSlot') &&
    adminStatisticsView.includes('slot-name="admin.dashboard.banner"') &&
    adminStatisticsView.includes('slot-name="admin.dashboard.widgets"') &&
    read('client/src/views/admin/BillingView.vue').includes('slot-name="admin.billing.banner"') &&
    read('client/src/views/admin/PaymentProvidersView.vue').includes('slot-name="admin.payment.providers.banner"') &&
    read('client/src/views/admin/PaymentProvidersView.vue').includes('v-if="!props.embedded"') &&
    read('client/src/views/admin/OAuthConfigView.vue').includes('slot-name="admin.oauth.banner"') &&
    portalView.includes('ThemeTemplateSlot') &&
    portalView.includes('slot-name="public.home.hero"') &&
    portalView.includes('slot-name="public.home.sections"') &&
    marketView.includes('ThemeTemplateSlot') &&
    marketView.includes('slot-name="public.market.banner"') &&
    loginView.includes('slot-name="public.auth.aside"') &&
    registerView.includes('slot-name="public.auth.aside"') &&
    forgotPasswordView.includes('slot-name="public.auth.aside"') &&
    publicSiteFooter.includes('ThemeTemplateSlot') &&
    publicSiteFooter.includes('slot-name="shared.footer"') &&
    pluginCenter.includes("'installed' | 'market' | 'submissions' | 'themes' | 'limits' | 'events' | 'tasks'") &&
    pluginCenter.includes('ThemeTemplateSlot') &&
    pluginCenter.includes('slot-name="admin.extensions.header"') &&
    pluginCenter.includes('slot-name="admin.extensions.market.banner"') &&
    pluginCenter.includes('slot-name="admin.extensions.theme.banner"') &&
    pluginCenter.includes("label: '主题'") &&
    pluginCenter.includes('themeMarket') &&
    pluginCenter.includes('loadThemeMarket') &&
    pluginCenter.includes('installMarketTheme') &&
    pluginCenter.includes('loadThemeSubmissions') &&
    pluginCenter.includes('scanThemeSubmission') &&
    pluginCenter.includes('publishThemeMarketIndex') &&
    pluginCenter.includes('主题投稿审核') &&
    pluginCenter.includes('主题市场') &&
    pluginCenter.includes('uploadTheme') &&
    pluginCenter.includes('themeConfigFields') &&
    pluginCenter.includes('themeConfigGroups') &&
    pluginCenter.includes('themeConfigGroupName') &&
    pluginCenter.includes('uploadThemeConfigFile') &&
    pluginCenter.includes('uploadingThemeConfigFileKey') &&
    pluginCenter.includes('saveThemeConfig') &&
    pluginCenter.includes('rollbackDefaultTheme') &&
    pluginCenter.includes('openThemePreview'),
  'client must expose theme APIs, load active theme CSS, and provide admin theme management UI'
)

assert(
  cleanThemeManifest.id === 'com.payincus.theme.clean' &&
    cleanThemeManifest.css === 'dist/theme.css' &&
    cleanThemeManifest.layoutSlots.includes('public.home.hero') &&
    cleanThemeManifest.layoutSlots.includes('public.home.sections') &&
    cleanThemeManifest.layoutSlots.includes('public.market.banner') &&
    cleanThemeManifest.layoutSlots.includes('public.auth.aside') &&
    cleanThemeManifest.layoutSlots.includes('user.shell.brand') &&
    cleanThemeManifest.layoutSlots.includes('user.dashboard.banner') &&
    cleanThemeManifest.layoutSlots.includes('user.dashboard.cards') &&
    cleanThemeManifest.layoutSlots.includes('user.instance.detail.extra') &&
    cleanThemeManifest.layoutSlots.includes('user.wallet.banner') &&
    cleanThemeManifest.layoutSlots.includes('user.tickets.banner') &&
    cleanThemeManifest.layoutSlots.includes('user.extensions.banner') &&
    cleanThemeManifest.layoutSlots.includes('user.orders.banner') &&
    cleanThemeManifest.layoutSlots.includes('user.profile.banner') &&
    cleanThemeManifest.layoutSlots.includes('user.invites.banner') &&
    cleanThemeManifest.layoutSlots.includes('user.hosts.banner') &&
    cleanThemeManifest.layoutSlots.includes('user.host.create.banner') &&
    cleanThemeManifest.layoutSlots.includes('admin.shell.brand') &&
    cleanThemeManifest.layoutSlots.includes('admin.extensions.header') &&
    cleanThemeManifest.layoutSlots.includes('admin.extensions.market.banner') &&
    cleanThemeManifest.layoutSlots.includes('admin.extensions.theme.banner') &&
    cleanThemeManifest.layoutSlots.includes('admin.dashboard.banner') &&
    cleanThemeManifest.layoutSlots.includes('admin.dashboard.widgets') &&
    cleanThemeManifest.layoutSlots.includes('admin.billing.banner') &&
    cleanThemeManifest.layoutSlots.includes('admin.payment.providers.banner') &&
    cleanThemeManifest.layoutSlots.includes('admin.oauth.banner') &&
    cleanThemeManifest.layoutSlots.includes('shared.footer') &&
    cleanThemeManifest.templates.some(template => template.slot === 'public.home.hero' && template.entry === 'templates/public/home-hero.html') &&
    cleanThemeManifest.templates.some(template => template.slot === 'public.home.sections' && template.entry === 'templates/public/home-sections.html') &&
    cleanThemeManifest.templates.some(template => template.slot === 'public.market.banner' && template.entry === 'templates/public/market-banner.html') &&
    cleanThemeManifest.templates.some(template => template.slot === 'public.auth.aside' && template.entry === 'templates/public/auth-aside.html') &&
    cleanThemeManifest.templates.some(template => template.slot === 'user.shell.brand' && template.entry === 'templates/user/shell-brand.html') &&
    cleanThemeManifest.templates.some(template => template.slot === 'user.dashboard.banner' && template.entry === 'templates/user/dashboard-banner.html') &&
    cleanThemeManifest.templates.some(template => template.slot === 'user.dashboard.cards' && template.entry === 'templates/user/dashboard-cards.html') &&
    cleanThemeManifest.templates.some(template => template.slot === 'user.instance.detail.extra' && template.entry === 'templates/user/instance-detail-extra.html') &&
    cleanThemeManifest.templates.some(template => template.slot === 'user.wallet.banner' && template.entry === 'templates/user/wallet-banner.html') &&
    cleanThemeManifest.templates.some(template => template.slot === 'user.tickets.banner' && template.entry === 'templates/user/tickets-banner.html') &&
    cleanThemeManifest.templates.some(template => template.slot === 'user.extensions.banner' && template.entry === 'templates/user/extensions-banner.html') &&
    cleanThemeManifest.templates.some(template => template.slot === 'user.orders.banner' && template.entry === 'templates/user/orders-banner.html') &&
    cleanThemeManifest.templates.some(template => template.slot === 'user.profile.banner' && template.entry === 'templates/user/profile-banner.html') &&
    cleanThemeManifest.templates.some(template => template.slot === 'user.invites.banner' && template.entry === 'templates/user/invites-banner.html') &&
    cleanThemeManifest.templates.some(template => template.slot === 'user.hosts.banner' && template.entry === 'templates/user/hosts-banner.html') &&
    cleanThemeManifest.templates.some(template => template.slot === 'user.host.create.banner' && template.entry === 'templates/user/host-create-banner.html') &&
    cleanThemeManifest.templates.some(template => template.slot === 'admin.shell.brand' && template.entry === 'templates/admin/shell-brand.html') &&
    cleanThemeManifest.templates.some(template => template.slot === 'admin.extensions.header' && template.entry === 'templates/admin/extensions-header.html') &&
    cleanThemeManifest.templates.some(template => template.slot === 'admin.extensions.market.banner' && template.entry === 'templates/admin/extensions-market-banner.html') &&
    cleanThemeManifest.templates.some(template => template.slot === 'admin.extensions.theme.banner' && template.entry === 'templates/admin/extensions-theme-banner.html') &&
    cleanThemeManifest.templates.some(template => template.slot === 'admin.dashboard.banner' && template.entry === 'templates/admin/dashboard-banner.html') &&
    cleanThemeManifest.templates.some(template => template.slot === 'admin.dashboard.widgets' && template.entry === 'templates/admin/dashboard-widgets.html') &&
    cleanThemeManifest.templates.some(template => template.slot === 'admin.billing.banner' && template.entry === 'templates/admin/billing-banner.html') &&
    cleanThemeManifest.templates.some(template => template.slot === 'admin.payment.providers.banner' && template.entry === 'templates/admin/payment-providers-banner.html') &&
    cleanThemeManifest.templates.some(template => template.slot === 'admin.oauth.banner' && template.entry === 'templates/admin/oauth-banner.html') &&
    cleanThemeManifest.templates.some(template => template.slot === 'shared.footer' && template.entry === 'templates/public/footer.html') &&
    cleanThemeManifest.configSchema.brandColor?.type === 'color' &&
    cleanThemeManifest.configSchema.layoutDensity?.type === 'select' &&
    cleanThemeManifest.configSchema.brandMark?.type === 'file' &&
    cleanThemeManifest.configSchema.notes?.type === 'placeholder',
  'official clean theme sample manifest must parse and declare CSS, slots, templates, and config schema fields'
)

assert(
  cleanThemeCss.includes('--payincus-theme-primary') &&
    !cleanThemeCss.includes('@import url(') &&
    cleanThemeTokens.includes('"primary": "#0f766e"') &&
    cleanThemeCss.includes('payincus-clean-market-banner') &&
    cleanThemeCss.includes('payincus-clean-extension-header') &&
    cleanThemeCss.includes('payincus-clean-extension-banner') &&
    cleanThemeCss.includes('payincus-clean-user-banner') &&
    cleanThemeCss.includes('payincus-clean-admin-banner') &&
    cleanThemeCss.includes('payincus-clean-admin-widgets') &&
    cleanThemeReadme.includes('tar -czf payincus-clean-theme.tar.gz') &&
    cleanThemeUsage.includes('GET /api/themes/active') &&
    cleanThemeUsage.includes('public.market.banner') &&
    cleanThemeUsage.includes('user.wallet.banner') &&
    cleanThemeUsage.includes('user.tickets.banner') &&
    cleanThemeUsage.includes('user.extensions.banner') &&
    cleanThemeUsage.includes('user.orders.banner') &&
    cleanThemeUsage.includes('user.profile.banner') &&
    cleanThemeUsage.includes('user.invites.banner') &&
    cleanThemeUsage.includes('user.hosts.banner') &&
    cleanThemeUsage.includes('user.host.create.banner') &&
    cleanThemeUsage.includes('admin.extensions.market.banner') &&
    cleanThemeUsage.includes('admin.billing.banner') &&
    cleanThemeUsage.includes('admin.payment.providers.banner') &&
    cleanThemeUsage.includes('admin.oauth.banner') &&
    cleanThemeUsage.includes('admin.dashboard.widgets') &&
    [cleanThemeHomeHero, cleanThemeHomeSections, cleanThemeMarketBanner, cleanThemeAuthAside, cleanThemeUserShellBrand, cleanThemeUserBanner, cleanThemeUserCards, cleanThemeInstanceDetailExtra, cleanThemeWalletBanner, cleanThemeTicketsBanner, cleanThemeExtensionsBanner, cleanThemeOrdersBanner, cleanThemeProfileBanner, cleanThemeInvitesBanner, cleanThemeHostsBanner, cleanThemeHostCreateBanner, cleanThemeAdminShellBrand, cleanThemeAdminExtensionsHeader, cleanThemeAdminExtensionsMarketBanner, cleanThemeAdminExtensionsThemeBanner, cleanThemeAdminBanner, cleanThemeAdminWidgets, cleanThemeAdminBillingBanner, cleanThemeAdminPaymentProvidersBanner, cleanThemeAdminOAuthBanner, cleanThemeFooter].every(fragment =>
      !/<script/i.test(fragment) &&
      !/<iframe/i.test(fragment) &&
      !/<form/i.test(fragment) &&
      !/on[a-z]+\s*=/i.test(fragment) &&
      !/javascript:/i.test(fragment) &&
      !/https?:\/\//i.test(fragment)
    ) &&
    templatesDocs.includes('theme-templates/clean-theme') &&
    templatesDocs.includes('官方主题样板') &&
    templatesDocs.includes('public.market.banner') &&
    templatesDocs.includes('user.wallet.banner') &&
    templatesDocs.includes('user.tickets.banner') &&
    templatesDocs.includes('user.extensions.banner') &&
    templatesDocs.includes('user.orders.banner') &&
    templatesDocs.includes('user.profile.banner') &&
    templatesDocs.includes('user.invites.banner') &&
    templatesDocs.includes('user.hosts.banner') &&
    templatesDocs.includes('user.host.create.banner') &&
    templatesDocs.includes('admin.extensions.header') &&
    templatesDocs.includes('admin.dashboard.widgets') &&
    templatesDocs.includes('admin.billing.banner') &&
    templatesDocs.includes('admin.payment.providers.banner') &&
    templatesDocs.includes('admin.oauth.banner') &&
    templatesDocs.includes('payincus-clean-theme.tar.gz'),
  'official clean theme sample must document packaging and keep CSS/templates within the safe visual-only boundary'
)

assert(
  envExample.includes('THEME_INSTALL_DIR=/opt/incudal/themes') &&
    envExample.includes('THEME_DATA_DIR=/opt/incudal/theme-data') &&
    envExample.includes('THEME_MARKET_INDEX_URL=https://payincus.com/theme-market/index.json') &&
    envExample.includes('THEME_MARKET_TRUSTED_HOSTS=') &&
    envExample.includes('THEME_MARKET_PUBLISH_DIR=/opt/incudal/theme-market') &&
    envExample.includes('THEME_MARKET_PUBLIC_BASE_URL=https://payincus.com/theme-market') &&
    envExample.includes('THEME_STAGING_DIR=/opt/incudal/theme-staging') &&
    installPanel.includes('THEME_INSTALL_DIR') &&
    installPanel.includes('THEME_DATA_DIR') &&
    installPanel.includes('theme-data') &&
    installPanel.includes('THEME_MARKET_INDEX_URL') &&
    installPanel.includes('THEME_MARKET_TRUSTED_HOSTS') &&
    installPanel.includes('THEME_MARKET_PUBLISH_DIR') &&
    installPanel.includes('THEME_MARKET_PUBLIC_BASE_URL') &&
    readme.includes('payincus.theme.json') &&
    readme.includes('/theme-market/index.json') &&
    readme.includes('受控配置表单') &&
    developmentDocs.includes('payincus.theme.json') &&
    developmentDocs.includes('PUT /api/admin/themes/:themeId/config') &&
    developmentDocs.includes('字段可以声明 `group` 和 `order`') &&
    developmentDocs.includes('THEME_DATA_DIR/config-files') &&
    developmentDocs.includes('/api/themes/:themeId/config-files/:key/:filename') &&
    developmentDocs.includes('THEME_MARKET_INDEX_URL=https://payincus.com/theme-market/index.json') &&
    developmentDocs.includes('theme-market/index.json') &&
    developmentDocs.includes('POST /api/theme-market-submissions/admin/publish-market-index') &&
    developmentDocs.includes('只会发布 `reviewStatus = listed` 且 `scanStatus = passed` 或 `warning` 的投稿') &&
    developmentDocs.includes('主题配置表单由 `configSchema` 声明') &&
    developmentDocs.includes('`theme.config_update` 审计日志') &&
    developmentDocs.includes('配置值固定脱敏为 `values=redacted`') &&
    developmentDocs.includes('不会把主题配置值、文件 URL 或密钥写入日志') &&
    developmentDocs.includes('受控 HTML 模板片段') &&
    developmentDocs.includes('templateUrls') &&
    developmentDocs.includes('禁止 `<script>`、`iframe`、`form`') &&
    developmentDocs.includes('公共首页、套餐市场页、认证页、用户/后台 shell 品牌、用户仪表盘、实例详情页、钱包页、工单页、扩展页、订单页、资料页、邀请页、节点列表页、新增节点页、后台扩展中心、后台统计页、后台计费、支付渠道、OAuth Provider 和共享页脚已经渲染') &&
    enOverviewDocs.includes('## Theme System') &&
    enOverviewDocs.includes('The real theme system is independent from normal page extensions') &&
    enOverviewDocs.includes('theme submission review/scan/publish') &&
    enOverviewDocs.includes('/api/themes/active') &&
    enOverviewDocs.includes('cannot inject unauthorized remote scripts') &&
    developmentDocs.includes('`public.market.banner`') &&
    developmentDocs.includes('`user.dashboard.cards`') &&
    developmentDocs.includes('`user.instance.detail.extra`') &&
    developmentDocs.includes('`user.wallet.banner`') &&
    developmentDocs.includes('`user.tickets.banner`') &&
    developmentDocs.includes('`user.extensions.banner`') &&
    developmentDocs.includes('`user.orders.banner`') &&
    developmentDocs.includes('`user.profile.banner`') &&
    developmentDocs.includes('`user.invites.banner`') &&
    developmentDocs.includes('`user.hosts.banner`') &&
    developmentDocs.includes('`user.host.create.banner`') &&
    developmentDocs.includes('`admin.extensions.header`') &&
    developmentDocs.includes('`admin.extensions.market.banner`') &&
    developmentDocs.includes('`admin.extensions.theme.banner`') &&
    developmentDocs.includes('`admin.dashboard.widgets`') &&
    developmentDocs.includes('`admin.billing.banner`') &&
    developmentDocs.includes('`admin.payment.providers.banner`') &&
    developmentDocs.includes('`admin.oauth.banner`') &&
    platformPlan.includes('主题包安装、市场安装、投稿审核/扫描/发布器、预览、启用、回滚、配置表单和受控模板片段首版') &&
    platformPlan.includes('后台统计页横幅/运营 widget、后台计费/支付渠道/OAuth Provider banner') &&
    platformPlan.includes('字段分组排序') &&
    platformPlan.includes('扩展和主题 file 图片受控上传') &&
    platformPlan.includes('CSS/HTML 资产校验') &&
    serverPackage.includes('"publish:theme-market-index"') &&
    rootPackage.includes('"publish:theme-market-index"') &&
    themeMarketIndex.includes('"id": "com.payincus.theme.clean"') &&
    themeMarketIndex.includes('"reviewStatus": "listed"') &&
    themeMarketIndex.includes('https://payincus.com/theme-market/packages/com.payincus.theme.clean/1.0.0/theme.tar.gz') &&
    themeMarketIndex.includes('"checksumPinned": true'),
  'deployment and docs must describe theme runtime directories, config forms, and implemented theme package lifecycle'
)

assert(
  Array.isArray(parsedThemeMarketIndex.themes) &&
    parsedThemeMarketIndex.themes.length > 0 &&
    parsedThemeMarketIndex.themes.every(entry => {
      const manifestPath = resolve(root, 'docs-site/docs/public', new URL(entry.manifestUrl).pathname.slice(1))
      const packagePath = resolve(root, 'docs-site/docs/public', new URL(entry.downloadUrl).pathname.slice(1))
      if (!entry.id || !entry.latest || entry.reviewStatus !== 'listed') return false
      if (!entry.manifestUrl.includes('/theme-market/manifests/') || !entry.downloadUrl.includes('/theme-market/packages/')) return false
      if (!existsSync(manifestPath) || !existsSync(packagePath)) return false
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { id?: string; version?: string }
      if (manifest.id !== entry.id || manifest.version !== entry.latest) return false
      const sha256 = createHash('sha256').update(readFileSync(packagePath)).digest('hex')
      return sha256 === entry.sha256
    }),
  'docs-site theme market index must reference existing stable manifest/package artifacts whose package SHA256 matches the published index'
)

console.log('theme system guard checks passed')
