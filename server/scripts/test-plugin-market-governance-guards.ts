import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '../..')

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

const market = read('server/src/lib/plugin-market.ts')
const adminRoute = read('server/src/routes/admin-plugins.ts')
const submissionRoute = read('server/src/routes/plugin-market-submissions.ts')
const themeSubmissionRoute = read('server/src/routes/theme-market-submissions.ts')
const pluginPublisher = read('server/src/lib/plugin-market-publisher.ts')
const pluginDb = read('server/src/db/plugins.ts')
const submissionDb = read('server/src/db/plugin-market-submissions.ts')
const themePublisher = read('server/src/lib/theme-market-publisher.ts')
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
  pluginDb.includes('assertPluginCapabilitiesApprovedForListing') &&
    pluginDb.includes("riskLevel: { in: ['high', 'critical'] }") &&
    pluginDb.includes("reviews.every(review => review.status === 'approved')") &&
    submissionRoute.includes('assertPluginCapabilitiesApprovedForListing') &&
    submissionRoute.includes("code: 'PLUGIN_CAPABILITY_REVIEW_REQUIRED'") &&
    pluginPublisher.includes('assertPluginCapabilitiesApprovedForListing'),
  'high-risk plugin capabilities must be approved before listing and rechecked before public index publishing'
)

assert.ok(
  submissionRoute.includes("typeof request.body?.developerVerified === 'boolean'") &&
    submissionDb.includes('developerVerifiedByUserId: input.developerVerified ? input.reviewedByUserId : null') &&
    pluginPublisher.includes("trustLevel: developerVerified ? 'verified' : 'third_party'") &&
    pluginPublisher.includes('verified: developerVerified') &&
    !pluginPublisher.includes("submission.developerGithub ? 'verified'") &&
    !pluginPublisher.includes('Boolean(submission.developerGithub)'),
  'verified trust must require an explicit administrator decision; a GitHub URL is display-only'
)

assert.ok(
  submissionRoute.includes("reviewStatus === 'listed'") &&
    submissionRoute.includes('!isFreePricing(submission.pricing)') &&
    submissionRoute.includes("PAID_MARKET_LISTING_NOT_AVAILABLE = '付费上架暂未开放(交易闭环未上线)'") &&
    themeSubmissionRoute.includes('!isFreePricing(body.pricing)') &&
    themeSubmissionRoute.includes("PAID_MARKET_LISTING_NOT_AVAILABLE = '付费上架暂未开放(交易闭环未上线)'"),
  'plugin and theme market governance must reject non-free pricing before listing or accepting an explicitly priced theme submission'
)

assert.ok(
  submissionRoute.includes("const LISTABLE_SCAN_STATUSES = new Set(['passed', 'warning'])") &&
    submissionRoute.includes('!LISTABLE_SCAN_STATUSES.has(submission.scanStatus)') &&
    submissionRoute.includes("code: 'PLUGIN_MARKET_SCAN_NOT_APPROVED'"),
  'plugin market governance must reject listed review state unless the latest scan passed or completed with warnings'
)

assert.ok(
  !pluginPublisher.includes('readExistingMarketEntries') &&
    !themePublisher.includes('readExistingMarketEntries') &&
    pluginPublisher.includes('highestSubmissionById') &&
    themePublisher.includes('highestSubmissionById') &&
    pluginPublisher.includes('compareSemVer(version, current.version) > 0') &&
    themePublisher.includes('compareSemVer(version, current.version) > 0'),
  'market governance must rebuild public indexes from current DB state and publish one highest SemVer version per ID'
)

assert.ok(
  market.includes('compareVersions') &&
    market.includes('normalizePluginMarketCompatibility(entry.compatibility)') &&
    market.includes('const payincus = pickString(record.payincus, 80)') &&
    !market.includes('minPayincus: pickString(record.minPayincus') &&
    !market.includes('maxPayincus: pickString(record.maxPayincus') &&
    market.includes('compatibility.minPayincus') &&
    market.includes('compatibility.maxPayincus') &&
    market.includes('Plugin requires PayIncus') &&
    market.includes('Plugin supports PayIncus up to') &&
    market.includes('Plugin market entry must pin a SHA256 checksum'),
  'plugin installs must enforce compatibility and pinned checksum before downloading'
)

assert.ok(
  market.includes("PLUGIN_MARKET_SUPPORTED_CURRENCIES = ['CNY', 'USD']") &&
    market.includes('PLUGIN_MARKET_PLATFORM_REVENUE_SHARE_PERCENT = 20') &&
    market.includes('price?: number') &&
    pluginPublisher.includes('persistSubmissionArtifacts') &&
    pluginPublisher.includes('Listed submission artifacts must use managed review uploads') &&
    pluginPublisher.includes('Reviewed submission compatibility differs from manifest.payincus') &&
    pluginPublisher.includes('`${publicBaseUrl}/packages/') &&
    pluginPublisher.includes('`${publicBaseUrl}/manifests/'),
  'market governance must use canonical minor-unit pricing, manifest.payincus compatibility, and stable managed artifacts'
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
    clientTypes.includes('unavailableReason?: string') &&
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
    pluginCenter.includes('扩展市场源暂时不可用') &&
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
