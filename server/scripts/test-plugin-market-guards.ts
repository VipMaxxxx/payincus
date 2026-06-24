import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '../..')

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

const market = read('server/src/lib/plugin-market.ts')
const adminRoute = read('server/src/routes/admin-plugins.ts')
const envExample = read('.env.example')
const releaseWorkflow = read('.github/workflows/release.yml')

assert.ok(
  market.includes('PLUGIN_MARKET_INDEX_URL') &&
    market.includes('assertGitHubIndexUrl') &&
    market.includes('raw.githubusercontent.com') &&
    market.includes('assertGitHubReleaseUrl') &&
    market.includes('/releases/download/') &&
    market.includes('Plugin package SHA256 mismatch') &&
    market.includes("createHash('sha256')"),
  'plugin market must read a GitHub-hosted index and require GitHub release artifacts with SHA256 verification'
)

assert.ok(
  adminRoute.includes('/market/install') &&
    adminRoute.includes('downloadMarketPlugin(entry)') &&
    adminRoute.includes("sourceType: 'market'") &&
    adminRoute.includes('PLUGIN_MARKET_INSTALL_FAILED'),
  'admin market install route must download and install through the guarded market path'
)

assert.ok(
  envExample.includes('PLUGIN_MARKET_INDEX_URL=') &&
    envExample.includes('PLUGIN_INSTALL_DIR=/opt/incudal/plugins') &&
    envExample.includes('PLUGIN_MAX_PACKAGE_SIZE_MB=20'),
  'plugin market and install settings must be documented in env example'
)

assert.ok(
  releaseWorkflow.includes('生成官方插件市场资产') &&
    releaseWorkflow.includes('plugin-market-index.json') &&
    releaseWorkflow.includes('payincus-plugin-ai-ticket-agent') &&
    releaseWorkflow.includes('com.payincus.ai-ticket-agent') &&
    releaseWorkflow.includes('sha256sum "${PLUGIN_PACKAGE}"'),
  'release workflow must publish the official AI plugin package, manifest, and market index assets'
)

console.log('plugin market guard tests passed')
