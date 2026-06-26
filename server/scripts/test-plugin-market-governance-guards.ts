import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '../..')

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

const market = read('server/src/lib/plugin-market.ts')
const adminRoute = read('server/src/routes/admin-plugins.ts')
const clientTypes = read('client/src/types/api.ts')
const pluginCenter = read('client/src/views/admin/PluginCenterView.vue')
const releaseWorkflow = read('.github/workflows/release.yml')
const docsMarketIndex = read('docs-site/docs/public/plugin-market/index.json')

assert.ok(
  market.includes("PluginMarketReviewStatus = 'pending' | 'listed' | 'delisted' | 'rejected'") &&
    market.includes("PluginMarketTrustLevel = 'official' | 'verified' | 'third_party'") &&
    market.includes('PluginMarketDeveloper') &&
    market.includes('PluginMarketPermissions') &&
    market.includes('PluginMarketCompatibility') &&
    market.includes('PluginMarketSecurity') &&
    market.includes('PluginMarketPricing') &&
    market.includes("reviewStatus === 'listed'") &&
    market.includes('defaultReviewStatus') &&
    market.includes('fingerprint: getMarketFingerprint') &&
    market.includes('assertMarketEntryInstallable') &&
    market.includes('payincus.com') &&
    market.includes('PLUGIN_MARKET_TRUSTED_HOSTS'),
  'plugin market must model review, trust, developer, permissions, compatibility, security, pricing and listed-only governance'
)

assert.ok(
  market.includes('compareVersions') &&
    market.includes('entry.compatibility.minPayincus') &&
    market.includes('entry.compatibility.maxPayincus') &&
    market.includes('Plugin requires PayIncus') &&
    market.includes('Plugin supports PayIncus up to') &&
    market.includes('Plugin market entry must pin a SHA256 checksum'),
  'plugin installs must enforce compatibility and pinned checksum before downloading'
)

assert.ok(
  adminRoute.includes('assertMarketEntryInstallable(entry)') &&
    adminRoute.includes('entry.reviewStatus') &&
    adminRoute.includes('entry.trustLevel') &&
    adminRoute.includes("entry.sha256.slice(0, 12)") &&
    adminRoute.includes('plugin.market_install'),
  'admin market install route must audit governance metadata when installing'
)

assert.ok(
  clientTypes.includes('PluginMarketGovernance') &&
    clientTypes.includes("reviewStatus: 'pending' | 'listed' | 'delisted' | 'rejected'") &&
    clientTypes.includes("trustLevel: 'official' | 'verified' | 'third_party'") &&
    clientTypes.includes('revenueSharePercent') &&
    clientTypes.includes('minPayincus') &&
    clientTypes.includes('maxPayincus'),
  'client API types must expose plugin market governance fields'
)

assert.ok(
  pluginCenter.includes('索引指纹') &&
    pluginCenter.includes('已上架') &&
    pluginCenter.includes('可信来源') &&
    pluginCenter.includes('兼容范围') &&
    pluginCenter.includes('权限声明') &&
    pluginCenter.includes('buildMarketInstallConfirmation') &&
    pluginCenter.includes('canInstallMarketEntry(entry)'),
  'plugin center UI must disclose governance fields and require install confirmation'
)

assert.ok(
  releaseWorkflow.includes("reviewStatus: 'listed'") &&
    releaseWorkflow.includes("trustLevel: 'official'") &&
    releaseWorkflow.includes('developer:') &&
    releaseWorkflow.includes('permissions:') &&
    releaseWorkflow.includes('compatibility:') &&
    releaseWorkflow.includes('checksumPinned: true') &&
    releaseWorkflow.includes("type: 'free'") &&
    releaseWorkflow.includes('revenueSharePercent'),
  'official plugin market index must publish governance metadata'
)

assert.ok(
  docsMarketIndex.includes('"reviewStatus": "listed"') &&
    docsMarketIndex.includes('"trustLevel": "official"') &&
    docsMarketIndex.includes('https://payincus.com/plugin-market/packages/') &&
    docsMarketIndex.includes('"sha256": "') &&
    docsMarketIndex.includes('"checksumPinned": true') &&
    docsMarketIndex.includes('"minPayincus": "v0.4.0"'),
  'docs-site stable extension market index must publish installable governed entries'
)

console.log('plugin market governance guard tests passed')
