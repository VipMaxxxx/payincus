import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '../..')

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

const market = read('server/src/lib/plugin-market.ts')
const runtimeSettings = read('server/src/lib/runtime-settings.ts')
const adminRoute = read('server/src/routes/admin-plugins.ts')
const envExample = read('.env.example')
const releaseWorkflow = read('.github/workflows/release.yml')
const docsMarketIndex = JSON.parse(read('docs-site/docs/public/plugin-market/index.json')) as {
  plugins?: Array<{ id: string; latest: string; manifestUrl: string; downloadUrl: string; sha256: string; reviewStatus: string }>
}

assert.ok(
  market.includes('getPluginMarketIndexUrl as getConfiguredPluginMarketIndexUrl') &&
    market.includes('getPluginMarketTrustedHosts') &&
    runtimeSettings.includes("'plugin_market_index_url'") &&
    runtimeSettings.includes('PLUGIN_MARKET_INDEX_URL') &&
    runtimeSettings.includes("'plugin_market_trusted_hosts'") &&
    runtimeSettings.includes('PLUGIN_MARKET_TRUSTED_HOSTS') &&
    market.includes('payincus.com') &&
    market.includes('/plugin-market/index.json') &&
    market.includes('assertGitHubIndexUrl') &&
    market.includes('raw.githubusercontent.com') &&
    market.includes('Raw GitHub URLs may only be used for plugin market indexes') &&
    market.includes('assertGitHubReleaseUrl') &&
    market.includes('/releases/download/') &&
    market.includes('Stable plugin market assets must be under /plugin-market/packages or /plugin-market/manifests') &&
    market.includes('Plugin package SHA256 mismatch') &&
    market.includes("createHash('sha256')"),
  'plugin market must read a trusted stable index and require trusted package URLs with SHA256 verification'
)

assert.ok(
  adminRoute.includes('/market/install') &&
    adminRoute.includes('downloadMarketPlugin(entry)') &&
    adminRoute.includes("sourceType: 'market'") &&
    adminRoute.includes('PLUGIN_MARKET_INSTALL_FAILED'),
  'admin market install route must download and install through the guarded market path'
)

assert.ok(
  envExample.includes('PLUGIN_MARKET_INDEX_URL=https://payincus.com/plugin-market/index.json') &&
    envExample.includes('PLUGIN_MARKET_TRUSTED_HOSTS=payincus.com') &&
    envExample.includes('PLUGIN_INSTALL_DIR=/opt/incudal/plugins') &&
    envExample.includes('PLUGIN_MAX_PACKAGE_SIZE_MB=20'),
  'stable extension market and install settings must be documented in env example'
)

assert.ok(
  releaseWorkflow.includes('生成官方插件市场资产') &&
    releaseWorkflow.includes('plugin-market-index.json') &&
    releaseWorkflow.includes('payincus-plugin-ai-ticket-agent') &&
    releaseWorkflow.includes('com.payincus.ai-ticket-agent') &&
    releaseWorkflow.includes('sha256sum "${PLUGIN_PACKAGE}"'),
  'release workflow must publish the official AI plugin package, manifest, and market index assets'
)

assert.ok(
  Array.isArray(docsMarketIndex.plugins) &&
    docsMarketIndex.plugins.length > 0 &&
    docsMarketIndex.plugins.every(entry => {
      const manifestPath = resolve(repoRoot, 'docs-site/docs/public', new URL(entry.manifestUrl).pathname.slice(1))
      const packagePath = resolve(repoRoot, 'docs-site/docs/public', new URL(entry.downloadUrl).pathname.slice(1))
      if (!entry.id || !entry.latest || entry.reviewStatus !== 'listed') return false
      if (!entry.manifestUrl.includes('/plugin-market/manifests/') || !entry.downloadUrl.includes('/plugin-market/packages/')) return false
      if (!existsSync(manifestPath) || !existsSync(packagePath)) return false
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { id?: string; version?: string }
      if (manifest.id !== entry.id || manifest.version !== entry.latest) return false
      const sha256 = createHash('sha256').update(readFileSync(packagePath)).digest('hex')
      return sha256 === entry.sha256
    }),
  'docs-site plugin market index must reference existing stable manifest/package artifacts whose package SHA256 matches the published index'
)

console.log('plugin market guard tests passed')
