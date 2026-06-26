import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '../..')

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

const schema = read('server/prisma/schema.prisma')
const migration = read('server/prisma/migrations/20260626110000_add_plugin_market_submission_scan/migration.sql')
const scanner = read('server/src/lib/plugin-market-submission-scan.ts')
const db = read('server/src/db/plugin-market-submissions.ts')
const route = read('server/src/routes/plugin-market-submissions.ts')
const adminView = read('client/src/views/admin/PluginCenterView.vue')
const userView = read('client/src/views/ExtensionsView.vue')
const adminApi = read('client/src/api/admin.ts')
const clientTypes = read('client/src/types/api.ts')
const developmentDocs = read('docs-site/docs/plugins/development.md')
const platformPlan = read('docs-site/docs/plugins/platform-plan.md')
const serverPackage = read('server/package.json')
const rootPackage = read('package.json')

assert.ok(
  schema.includes('scanStatus        String    @default("pending")') &&
    schema.includes('scanResult        Json      @default("{}")') &&
    schema.includes('scannedAt         DateTime?') &&
    schema.includes('@@index([scanStatus])') &&
    migration.includes('ADD COLUMN "scan_status" TEXT NOT NULL DEFAULT') &&
    migration.includes('ADD COLUMN "scan_result" JSONB NOT NULL DEFAULT') &&
    migration.includes('plugin_market_submissions_scan_status_idx'),
  'plugin market submissions must persist scan status, result, scan time, and scan indexes'
)

assert.ok(
  scanner.includes('scanPluginMarketSubmission') &&
    scanner.includes('assertSafeHttpUrl') &&
    scanner.includes("safeUrl.protocol !== 'https:'") &&
    scanner.includes('redirect: \'manual\'') &&
    scanner.includes('getPluginPackageMaxBytes') &&
    scanner.includes('parsePluginManifest') &&
    scanner.includes('validateAndExtractPluginPackage') &&
    scanner.includes('sha256_mismatch') &&
    scanner.includes('manifest_url_package_mismatch') &&
    scanner.includes('HIGH_RISK_PERMISSION_PATTERNS') &&
    scanner.includes('assessRisk'),
  'submission scanner must use SSRF-guarded HTTPS downloads, bounded package size, manifest/package validation, SHA256 checks, and risk scoring'
)

assert.ok(
  db.includes('updatePluginMarketSubmissionScan') &&
    db.includes('getPluginMarketSubmissionForReview') &&
    db.includes('scanStatus: submission.scanStatus') &&
    db.includes('scanResult: submission.scanResult') &&
    db.includes('scannedAt: submission.scannedAt') &&
    route.includes("'/admin/:id/scan'") &&
    route.includes('scanPluginMarketSubmission') &&
    route.includes('updatePluginMarketSubmissionScan') &&
    route.includes('plugin.market_submission.scan'),
  'submission scan route must be reviewer-only, persist scan results, and audit scans'
)

assert.ok(
  clientTypes.includes('PluginMarketSubmissionScanResult') &&
    clientTypes.includes('scanStatus:') &&
    adminApi.includes('scan: (id: number)') &&
    adminView.includes('scanSubmission') &&
    adminView.includes('扫描中...') &&
    adminView.includes('submissionScanFindings') &&
    userView.includes('submissionScanLabels'),
  'client types and UI must expose scan status, scan results, and scan actions'
)

assert.ok(
  developmentDocs.includes('POST /api/plugin-market-submissions/admin/:id/scan') &&
    developmentDocs.includes('HTTPS 公网地址') &&
    developmentDocs.includes('package SHA256 必须和提交值一致') &&
    developmentDocs.includes('扫描失败不会自动拒绝投稿') &&
    platformPlan.includes('投稿自动扫描首版') &&
    platformPlan.includes('文档站市场目录发布首版') &&
    platformPlan.includes('主题包安装、市场安装、投稿审核/扫描/发布器、预览、启用、回滚、配置表单和受控模板片段首版') &&
    platformPlan.includes('CSS/HTML 资产校验'),
  'docs must describe submission scanning guarantees and implemented theme market/template work'
)

assert.ok(
  serverPackage.includes('"test:plugin-market-submission-scan-guards"') &&
    rootPackage.includes('pnpm --filter server test:plugin-market-submission-scan-guards'),
  'plugin market submission scan guard must be wired into package scripts'
)

console.log('plugin market submission scan guard tests passed')
