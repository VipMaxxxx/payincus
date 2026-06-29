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
const restoreDrillScript = read('scripts/production-db-restore-drill.sh')

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
    view.includes('备份恢复演练') &&
    view.includes('不能覆盖生产数据') &&
    view.includes('const proofStats = computed') &&
    view.includes('const closedProofItems = computed') &&
    view.includes('const attentionProofItems = computed') &&
    view.includes('closedProofItems.value / proofStats.value.total') &&
    view.includes("status: 'waived'") &&
    view.includes("key: 'exchange'") &&
    view.includes('交易所真实交割闭环') &&
    view.includes("status: 'operator'") &&
    view.includes('暂停实例挂牌、余额购买、托管、强制重装、匿名交割、确认期结算、提现审核和争议/退款路径') &&
    view.includes('不得记录买卖双方身份、实例原数据、root 密码、SSH 私钥或完整回调内容') &&
    view.includes('Lsky 删除清理 proof 已按运营方决定排除出最终阻塞项。') &&
    view.includes('不要记录为已删除') &&
    view.includes('ENV_FILE=/opt/incudal/.env NODE_ENV=production node server/dist/scripts/lsky-production-proof.js') &&
    view.includes('交易所 live E2E 记录模板') &&
    view.includes('ENV_FILE=/opt/incudal/.env pnpm --filter server verify:production-db') &&
    view.includes('卖家测试实例已暂停并通过交易所检测') &&
    view.includes('交割任务完成强制重装、匿名重命名、owner 转移、买家账单重建、流量基线重置') &&
    view.includes('LIVE_LSKY_CLEANUP_WAIVER_REF="operator waiver ref"') &&
    view.includes('BACKEND_URL="$PRODUCTION_BACKEND_LOOPBACK_URL"') &&
    view.includes('ENV_FILE=/opt/incudal/.env PROOF_SINCE_HOURS=24 pnpm verify:production-proof-snapshot') &&
    view.includes('REQUIRE_LIVE_PROOF_REFS=1 pnpm verify:live-acceptance') &&
    view.includes('禁止写入审计记录的内容'),
  'production proof workspace must explain read-only behavior, backup/restore boundaries, current proof progress, exchange live E2E operator proof, proof commands, final refs, and redaction rules'
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
    zhDocs.includes('重启、重装/重建、删除、清理') &&
    zhDocs.includes('Turnstile 登录') &&
    zhDocs.includes('备份恢复演练') &&
    enDocs.includes('/admin/production-proof') &&
    enDocs.includes('Production Proof workspace') &&
    enDocs.includes('restart, recreate/rebuild, delete, cleanup') &&
    enDocs.includes('Turnstile login') &&
    enDocs.includes('Backup/restore drill'),
  'public docs must mention the admin production proof workspace and all remaining proof classes in both languages'
)

assert.ok(
  restoreDrillScript.includes('DRILL_PREFIX="${DRILL_PREFIX:-incudal_restore_drill}"') &&
    restoreDrillScript.includes('TEMP_DB_NAME="${DRILL_PREFIX}_${DRILL_ID//[^A-Za-z0-9_]/_}"') &&
    restoreDrillScript.includes('PGDATABASE="$SOURCE_DB" pg_dump --format=custom --no-owner --no-privileges') &&
    restoreDrillScript.includes('PGDATABASE="$TEMP_DB_NAME" pg_restore --dbname "$TEMP_DB_NAME" --no-owner --no-privileges --exit-on-error') &&
    restoreDrillScript.includes('PGDATABASE="$RESTORE_DRILL_MAINTENANCE_DB" dropdb --if-exists "$TEMP_DB_NAME"') &&
    restoreDrillScript.includes('runuser -u postgres -- createdb -O "$PGUSER" "$TEMP_DB_NAME"') &&
    restoreDrillScript.includes('runuser -u postgres -- dropdb --if-exists "$TEMP_DB_NAME"') &&
    restoreDrillScript.includes('rm -rf "$WORKDIR"') &&
    !restoreDrillScript.includes('dropdb --if-exists "$SOURCE_DB"') &&
    !restoreDrillScript.includes('PGDATABASE="$SOURCE_DB" pg_restore'),
  'production database restore drill must dump production and restore only into a temporary database with cleanup'
)

console.log('production proof center guard tests passed')
