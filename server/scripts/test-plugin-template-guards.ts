import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parsePluginManifest } from '../src/lib/plugin-manifest.js'
import { validateAndExtractPluginPackage } from '../src/lib/plugin-package.js'
import { validateAndExtractThemePackage } from '../src/lib/theme-package.js'

const repoRoot = resolve(import.meta.dirname, '../..')

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

const rawFlashSaleManifest = JSON.parse(read('plugin-templates/flash-sale-plugin/payincus.plugin.json'))
const flashSaleManifest = parsePluginManifest(rawFlashSaleManifest)
const rawAiTicketManifest = JSON.parse(read('plugin-templates/ai-ticket-agent-plugin/payincus.plugin.json'))
const aiTicketManifest = parsePluginManifest(rawAiTicketManifest)
const flashSaleReadme = read('plugin-templates/flash-sale-plugin/README.md')
const flashSaleUsage = read('plugin-templates/flash-sale-plugin/docs/usage.md')
const flashSaleAdmin = read('plugin-templates/flash-sale-plugin/dist/admin/settings.html')
const flashSaleUser = read('plugin-templates/flash-sale-plugin/dist/user/index.html')
const flashSaleConfig = read('plugin-templates/flash-sale-plugin/templates/default-config.json')
const templatesDocs = read('docs-site/docs/plugins/templates.md')
const developmentDocs = read('docs-site/docs/plugins/development.md')
const platformPlan = read('docs-site/docs/plugins/platform-plan.md')
const serverPackage = read('server/package.json')
const rootPackage = read('package.json')
const officialPluginTemplates = [
  'basic-admin-plugin',
  'user-sidebar-plugin',
  'admin-user-mixed-plugin',
  'ai-ticket-agent-plugin',
  'flash-sale-plugin'
]

assert.equal(flashSaleManifest.id, 'com.example.flash-sale')
assert.equal(flashSaleManifest.version, '1.0.0')
assert.equal(aiTicketManifest.id, 'com.payincus.ai-ticket-agent')
assert.equal(aiTicketManifest.configSchema?.enabled?.type, 'checkbox')
assert.equal(aiTicketManifest.configSchema?.mode?.type, 'select')
assert.equal(aiTicketManifest.configSchema?.apiKey?.secret, true)
assert.equal(aiTicketManifest.configSchema?.autoReplyCategories?.type, 'tags')

assert.ok(
  flashSaleManifest.entrypoints.adminPages?.some(page =>
    page.slot === 'admin.plugins.settings' &&
    page.entry === 'dist/admin/settings.html'
  ) &&
    flashSaleManifest.entrypoints.userPages?.some(page =>
      page.slot === 'user.sidebar.extra' &&
      page.path === '/plugins/flash-sale' &&
      page.entry === 'dist/user/index.html' &&
      page.requiresAuth === true
    ),
  'flash sale template must provide both admin settings and user-facing pages'
)

assert.ok(
  flashSaleManifest.configSchema?.campaignEnabled?.type === 'checkbox' &&
    flashSaleManifest.configSchema?.campaignId?.group === 'Campaign' &&
    flashSaleManifest.configSchema?.stockLimit?.type === 'number' &&
    flashSaleManifest.configSchema?.perUserLimit?.max === 20 &&
    flashSaleManifest.configSchema?.reserveWebhookSecret?.secret === true,
  'flash sale template must declare campaign, inventory, and secret admin settings'
)

const actions = flashSaleManifest.capabilities?.actions || []
assert.ok(
  actions.some(action =>
    action.name === 'reserveStock' &&
    action.runtime === 'webhook' &&
    action.idempotency === 'required' &&
    action.rateLimit === 'strict' &&
    action.scopes.includes('orders:create') &&
    action.scopes.includes('plugin-storage:write') &&
    action.requestSchema &&
    action.responseSchema
  ) &&
    actions.some(action => action.name === 'confirmPaidReservation' && action.idempotency === 'required') &&
    actions.some(action => action.name === 'releaseReservation' && action.idempotency === 'required'),
  'flash sale template must declare webhook actions with schemas, scopes, idempotency, and rate limits'
)

assert.ok(
  flashSaleManifest.capabilities?.events?.some(event => event.event === 'order.paid' && event.handler === 'confirmPaidReservation') &&
    flashSaleManifest.capabilities.events.some(event => event.event === 'payment.failed' && event.handler === 'releaseReservation') &&
    flashSaleManifest.capabilities.notificationTemplates?.some(template =>
      template.id === 'reservation_reminder' &&
      template.variables?.includes('campaignName') &&
      template.message.includes('{{startsAt}}')
    ) &&
    flashSaleManifest.capabilities.storage?.kind === 'kv' &&
    flashSaleManifest.capabilities.storage.scopes?.includes('global') &&
    flashSaleManifest.capabilities.storage.scopes?.includes('user') &&
    flashSaleManifest.capabilities.storage.scopes?.includes('service'),
  'flash sale template must subscribe to payment events and declare scoped KV storage'
)

assert.ok(
    flashSaleReadme.includes('Admin settings page') &&
    flashSaleReadme.includes('User campaign page') &&
    flashSaleReadme.includes('Plugin-declared notification templates') &&
    flashSaleReadme.includes('tar -czf flash-sale-plugin.tar.gz') &&
    flashSaleUsage.includes('x-payincus-plugin-signature') &&
    flashSaleUsage.includes('idempotencyKey') &&
    flashSaleUsage.includes('dedupeKey') &&
    flashSaleAdmin.includes('reserveStock') &&
    flashSaleAdmin.includes('Scoped KV') &&
    flashSaleUser.includes('/api/v1/products') &&
    !flashSaleUser.includes('/api/admin/') &&
    flashSaleConfig.includes('"campaignId": "summer-2026"'),
  'flash sale template files must document safe operation, webhook signing, idempotency, dedupe, and public API boundaries'
)

assert.ok(
  templatesDocs.includes('plugin-templates/flash-sale-plugin') &&
    templatesDocs.includes('plugin-templates/ai-ticket-agent-plugin') &&
    templatesDocs.includes('五个扩展模板') &&
    templatesDocs.includes('前台页面 + 后台设置 + webhook action + 事件订阅 + scoped KV 存储') &&
    templatesDocs.includes('tar -czf flash-sale-plugin.tar.gz') &&
    developmentDocs.includes('capabilities.notificationTemplates') &&
    developmentDocs.includes('plugin:com.example.flash-sale:reservation_reminder') &&
    developmentDocs.includes('秒杀扩展需要声明后台设置页、前台活动页') &&
    platformPlan.includes('官方扩展和主题模板首版') &&
    platformPlan.includes('均可按文档打包，并通过平台扩展/主题包校验器') &&
    platformPlan.includes('秒杀扩展验收样例'),
  'extension docs must surface the flash sale template as the end-to-end acceptance sample'
)

const tmp = await mkdtemp(resolve(tmpdir(), 'payincus-template-'))
try {
  for (let index = 0; index < officialPluginTemplates.length; index += 1) {
    const template = officialPluginTemplates[index]
    const packagePath = resolve(tmp, `${template}.tar.gz`)
    const tar = spawnSync('tar', [
      '-czf',
      packagePath,
      '-C',
      resolve(repoRoot, 'plugin-templates', template),
      'payincus.plugin.json',
      'README.md',
      'dist',
      'templates',
      'docs'
    ], { stdio: 'pipe' })
    assert.equal(tar.status, 0, `failed to package plugin template ${template}: ${tar.stderr.toString()}`)
    const validated = await validateAndExtractPluginPackage(packagePath, 9100 + index)
    assert.ok(validated.manifest.id.includes('.'), `plugin template ${template} must validate to a plugin manifest`)
  }

  const themePackagePath = resolve(tmp, 'clean-theme.tar.gz')
  const themeTar = spawnSync('tar', [
    '-czf',
    themePackagePath,
    '-C',
    resolve(repoRoot, 'theme-templates/clean-theme'),
    'payincus.theme.json',
    'README.md',
    'dist',
    'tokens',
    'templates',
    'docs'
  ], { stdio: 'pipe' })
  assert.equal(themeTar.status, 0, `failed to package clean theme template: ${themeTar.stderr.toString()}`)
  const theme = await validateAndExtractThemePackage(themePackagePath, 'template-clean-theme')
  assert.equal(theme.manifest.id, 'com.payincus.theme.clean')
} finally {
  await rm(tmp, { recursive: true, force: true })
}

assert.ok(
  serverPackage.includes('"test:plugin-template-guards"') &&
    rootPackage.includes('pnpm --filter server test:plugin-template-guards'),
  'plugin template guard must be wired into package scripts'
)

console.log('plugin template guard tests passed')
