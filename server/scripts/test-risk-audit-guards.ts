import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  classifyLogRisk,
  getRiskOperationDefinitions,
  redactAuditText
} from '../src/lib/risk-audit.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const logsRouteSource = readFileSync(resolve(__dirname, '../src/routes/logs.ts'), 'utf8')
const logsDbSource = readFileSync(resolve(__dirname, '../src/db/logs.ts'), 'utf8')
const riskAuditSource = readFileSync(resolve(__dirname, '../src/lib/risk-audit.ts'), 'utf8')
const logsViewSource = readFileSync(resolve(__dirname, '../../client/src/views/LogsView.vue'), 'utf8')
const zhCnSource = readFileSync(resolve(__dirname, '../../client/src/locales/zh-CN.ts'), 'utf8')
const zhTwSource = readFileSync(resolve(__dirname, '../../client/src/locales/zh-TW.ts'), 'utf8')
const enSource = readFileSync(resolve(__dirname, '../../client/src/locales/en.ts'), 'utf8')

assert.ok(
  logsRouteSource.includes("fastify.get('/risk-definitions'") &&
    logsRouteSource.includes('onRequest: [fastify.authenticateAdmin]') &&
    logsRouteSource.includes('getRiskOperationDefinitions()'),
  'risk operation definitions must be exposed through an admin-only route'
)

assert.ok(
  logsRouteSource.includes("fastify.get<{\n    Querystring: {") &&
    logsRouteSource.includes("}>('/audit/export'") &&
    logsRouteSource.includes('onRequest: [fastify.authenticateAdmin]'),
  'audit export route must be admin-only'
)

assert.ok(
  logsRouteSource.includes('const AUDIT_EXPORT_LIMIT_MAX = 1000') &&
    logsRouteSource.includes('Math.min(parsePositiveInteger(limit) ?? 500, AUDIT_EXPORT_LIMIT_MAX)') &&
    logsRouteSource.includes('getLogsForAuditExport({'),
  'audit export must cap row count and use the dedicated export helper'
)

assert.ok(
  logsRouteSource.includes('content-type') &&
    logsRouteSource.includes('text/csv; charset=utf-8') &&
    logsRouteSource.includes('cache-control') &&
    logsRouteSource.includes('no-store') &&
    logsRouteSource.includes('audit.export'),
  'audit export must return no-store CSV and record an export audit log'
)

assert.ok(
  logsDbSource.includes('classifyLogRisk({') &&
    logsDbSource.includes('redactAuditText(log.content)') &&
    logsDbSource.includes('redactAuditText(log.user?.username') &&
    logsDbSource.includes('risk_level: risk.riskLevel') &&
    logsDbSource.includes('approval_required: risk.approvalRequired') &&
    logsDbSource.includes('verification_required: risk.verificationRequired'),
  'log query results must be enriched with risk metadata and redacted before returning'
)

assert.ok(
  riskAuditSource.includes('payment_provider.update') &&
    riskAuditSource.includes('balance.adjustment.review') &&
    riskAuditSource.includes('instance.batch_delete') &&
    riskAuditSource.includes('user.role.update') &&
    riskAuditSource.includes('plugin.install'),
  'risk catalog must include payment, balance, batch resource, role and plugin sensitive operations'
)

const definitions = getRiskOperationDefinitions()
assert.ok(definitions.length >= 15, 'risk catalog must contain a practical set of sensitive operations')
assert.equal(
  classifyLogRisk({ module: 'billing', action: 'payment_provider.update' }).riskLevel,
  'critical',
  'payment provider updates must be critical risk'
)
assert.equal(
  classifyLogRisk({ module: 'instance', action: 'instance.batch_delete' }).batchSensitive,
  true,
  'batch instance deletion must be marked batch-sensitive'
)
assert.equal(
  classifyLogRisk({ module: 'plugin', action: 'plugin.install' }).verificationRequired,
  true,
  'plugin installation must require verification evidence'
)

const redacted = redactAuditText('admin@example.com 82.152.90.37 Bearer secret-token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature')
assert.ok(!redacted.includes('admin@example.com'), 'audit redaction must mask email addresses')
assert.ok(!redacted.includes('82.152.90.37'), 'audit redaction must mask full IPv4 addresses')
assert.ok(!redacted.includes('Bearer secret-token'), 'audit redaction must mask bearer tokens')
assert.ok(!redacted.includes('eyJhbGci'), 'audit redaction must mask JWT-like values')

assert.ok(
  logsViewSource.includes('getRiskDefinitions') &&
    logsViewSource.includes('exportAuditCsv') &&
    logsViewSource.includes('risk_level') &&
    logsViewSource.includes('approval_required') &&
    logsViewSource.includes('verification_required'),
  'admin logs page must show risk metadata and expose audit export'
)

for (const [name, source] of [
  ['zh-CN', zhCnSource],
  ['zh-TW', zhTwSource],
  ['en', enSource]
] as const) {
  for (const key of [
    'riskLevel',
    'exportAudit',
    'auditExportSuccess',
    'auditExportFailed',
    'auditSummary',
    'riskDefinitions',
    'highRiskCurrentPage',
    'approvalRequired',
    'verificationRequired',
    'critical'
  ]) {
    assert.ok(source.includes(key), `${name} locale must include logs.${key}`)
  }
}

console.log('risk audit guard checks passed')
