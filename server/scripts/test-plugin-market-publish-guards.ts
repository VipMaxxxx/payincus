import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '../..')

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

const publisher = read('server/src/lib/plugin-market-publisher.ts')
const themePublisher = read('server/src/lib/theme-market-publisher.ts')
const route = read('server/src/routes/plugin-market-submissions.ts')
const pluginDb = read('server/src/db/plugins.ts')
const adminView = read('client/src/views/admin/PluginCenterView.vue')
const adminApi = read('client/src/api/admin.ts')
const clientTypes = read('client/src/types/api.ts')
const cli = read('server/scripts/publish-plugin-market-index.ts')
const serverPackage = read('server/package.json')
const rootPackage = read('package.json')
const envExample = read('.env.example')
const installPanel = read('scripts/install-panel.sh')
const developmentDocs = read('docs-site/docs/plugins/development.md')
const platformPlan = read('docs-site/docs/plugins/platform-plan.md')

assert.ok(
  publisher.includes('publishPluginMarketIndex') &&
    publisher.includes('PLUGIN_MARKET_PUBLISH_DIR') &&
    publisher.includes('PLUGIN_MARKET_PUBLIC_BASE_URL') &&
    publisher.includes("reviewStatus: 'listed'") &&
    publisher.includes("scanStatus: { in: ['passed', 'warning'] }") &&
    !publisher.includes('readExistingMarketEntries') &&
    !publisher.includes("readFile(indexPath, 'utf8')") &&
    publisher.includes('highestSubmissionById') &&
    publisher.includes("writeFile(indexPath, `${JSON.stringify(index, null, 2)}\\n`, 'utf8')") &&
    publisher.includes('fingerprint'),
  'plugin market publisher must rebuild index.json only from the currently listed and successfully scanned DB submissions'
)

assert.ok(
  publisher.includes('approvedListedSubmissions') &&
    publisher.includes('assertPluginCapabilitiesApprovedForListing') &&
    pluginDb.includes('assertPluginCapabilitiesApprovedForListing') &&
    publisher.includes('isPluginDeveloperVerifiedByAdmin') &&
    publisher.includes("trustLevel: developerVerified ? 'verified' : 'third_party'") &&
    !publisher.includes("submission.developerGithub ? 'verified'") &&
    !publisher.includes('Boolean(submission.developerGithub)'),
  'public publishing must exclude unapproved high-risk capabilities and grant verified trust only after admin certification'
)

assert.ok(
  publisher.includes('listedSubmissions.filter(submission => isFreeSubmissionPricing(submission.pricing))') &&
    publisher.includes("normalizePluginMarketPricing(value).type === 'free'") &&
    !publisher.includes('isFreeMarketEntry') &&
    !themePublisher.includes('hasFreeOrNoPricing') &&
    !themePublisher.includes('readExistingMarketEntries'),
  'plugin and theme market publishers must exclude paid legacy entries by rebuilding indexes from free current DB state'
)

assert.ok(
  publisher.includes('persistSubmissionArtifacts') &&
    publisher.includes("join('packages', submission.pluginId, `${submission.version}.tar.gz`)") &&
    publisher.includes("join('manifests', submission.pluginId, `${submission.version}.json`)") &&
    publisher.includes('copyFile(sourcePackagePath, packagePath)') &&
    publisher.includes('parsePluginManifest') &&
    publisher.includes('packageSha256 !== submission.sha256.toLowerCase()') &&
    publisher.includes('artifacts.manifest.payincus') &&
    publisher.includes('downloadUrl: artifacts.packageUrl') &&
    publisher.includes('manifestUrl: artifacts.manifestUrl') &&
    !publisher.includes('downloadUrl: submission.packageUrl'),
  'publishing must pin the reviewed package and canonical manifest into stable market package/manifest paths before indexing'
)

assert.ok(
  publisher.includes('function parseSemVer') &&
    publisher.includes('function compareSemVer') &&
    publisher.includes('compareSemVer(version, current.version) > 0') &&
    publisher.includes('publishedEntries: plugins.length') &&
    themePublisher.includes('function parseSemVer') &&
    themePublisher.includes('function compareSemVer') &&
    themePublisher.includes('compareSemVer(version, current.version) > 0') &&
    themePublisher.includes('publishedEntries: themes.length'),
  'plugin and theme market publishers must publish exactly one highest valid SemVer entry per ID (including 10.0.0 above 2.0.0)'
)

assert.ok(
  route.includes("'/admin/publish-market-index'") &&
    route.includes('publishPluginMarketIndex') &&
    route.includes('plugin.market_submission.publish_index') &&
    adminApi.includes('publishMarketIndex') &&
    adminApi.includes("http.post('/plugin-market-submissions/admin/publish-market-index'") &&
    adminView.includes('publishMarketIndex') &&
    adminView.includes('发布市场目录'),
  'admin routes and UI must expose market index publishing'
)

assert.ok(
  clientTypes.includes('PluginMarketPublishResult') &&
    cli.includes('publishPluginMarketIndex') &&
    serverPackage.includes('"publish:plugin-market-index"') &&
    serverPackage.includes('"test:plugin-market-publish-guards"') &&
    rootPackage.includes('pnpm --filter server test:plugin-market-publish-guards'),
  'publish result types, CLI script, and guard scripts must be wired'
)

assert.ok(
  envExample.includes('PLUGIN_MARKET_PUBLISH_DIR=') &&
    envExample.includes('PLUGIN_MARKET_PUBLIC_BASE_URL=') &&
    installPanel.includes('PLUGIN_MARKET_PUBLISH_DIR') &&
    installPanel.includes('PLUGIN_MARKET_PUBLIC_BASE_URL'),
  'market publish directory and public base URL must be documented and provisioned'
)

assert.ok(
    developmentDocs.includes('POST /api/plugin-market-submissions/admin/publish-market-index') &&
    developmentDocs.includes('只会发布 `reviewStatus = listed` 且 `scanStatus = passed` 或 `warning` 的投稿') &&
    platformPlan.includes('文档站市场目录发布首版') &&
    platformPlan.includes('主题包安装、市场安装、投稿审核/扫描/发布器、预览、启用、回滚、配置表单和受控模板片段首版') &&
    platformPlan.includes('CSS/HTML 资产校验'),
  'docs must describe automated market index publishing and implemented theme market/template work'
)

console.log('plugin market publish guard tests passed')
