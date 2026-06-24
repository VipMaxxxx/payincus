import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(process.cwd(), '..')

function read(path: string): string {
  return readFileSync(resolve(root, path), 'utf8')
}

const adminRouter = read('client/src/router/admin.ts')
const userRouter = read('client/src/router/user.ts')
const adminNav = read('client/src/config/side-nav-items-admin.ts')
const userNav = read('client/src/config/side-nav-items-user.ts')
const view = read('client/src/views/admin/ProductionProofView.vue')
const userApi = read('client/src/api/index.ts')
const adminApi = read('client/src/api/admin.ts')
const viteConfig = read('client/vite.config.ts')
const zh = read('client/src/locales/zh-CN.ts')
const en = read('client/src/locales/en.ts')
const tw = read('client/src/locales/zh-TW.ts')
const zhDocs = read('docs-site/docs/deployment/production-checklist.md')
const enDocs = read('docs-site/docs/en/deployment/production-checklist.md')

assert.ok(
  adminRouter.includes("path: '/admin/production-proof'") &&
    adminRouter.includes("name: 'admin-production-proof'") &&
    adminRouter.includes("requiresAdmin: true") &&
    adminRouter.includes("titleKey: 'nav.productionProof'"),
  'production proof workspace must be an admin-only route'
)

assert.ok(
  adminNav.includes("path: '/admin/production-proof'") &&
    adminNav.includes("label: 'nav.productionProof'") &&
    adminNav.includes("icon: 'logs'"),
  'production proof workspace must be visible in the admin operations navigation'
)

assert.ok(
  !userRouter.includes('/admin/production-proof') &&
    !userNav.includes('productionProof') &&
    !userApi.includes('/admin/production-proof'),
  'production proof workspace must not appear in the user router, user nav, or user API client'
)

assert.ok(
  zh.includes("productionProof: '生产验收'") &&
    en.includes("productionProof: 'Production Proof'") &&
    tw.includes("productionProof: '生產驗收'") &&
    viteConfig.includes("'productionProof'"),
  'production proof nav label must be localized and stripped from the user locale bundle'
)

assert.ok(
  view.includes('此页面只读') &&
    view.includes('不会执行支付、资源删除、Turnstile 变更或 OTA 回滚') &&
    view.includes('ENV_FILE=/opt/incudal/.env PROOF_SINCE_HOURS=24 pnpm verify:production-proof-snapshot') &&
    view.includes('REQUIRE_LIVE_PROOF_REFS=1 pnpm verify:live-acceptance') &&
    view.includes('禁止写入审计记录的内容'),
  'production proof workspace must explain read-only behavior, proof commands, final refs, and redaction rules'
)

const forbiddenExecutionMarkers = [
  'api.',
  'fetch(',
  'axios',
  'startSystemUpdate',
  'deleteInstance',
  'send-test',
  'telegram/admin/webhook',
  'ticket_image_lsky_token'
]

const executionFailures = forbiddenExecutionMarkers.filter(marker => view.includes(marker))
assert.deepEqual(
  executionFailures,
  [],
  `production proof workspace must not execute backend APIs or high-risk actions: ${executionFailures.join(', ')}`
)

assert.ok(
  zhDocs.includes('/admin/production-proof') &&
    zhDocs.includes('生产验收工作台') &&
    enDocs.includes('/admin/production-proof') &&
    enDocs.includes('Production Proof workspace'),
  'public docs must mention the admin production proof workspace in both languages'
)

console.log('production proof center guard tests passed')
