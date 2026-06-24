import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const routeSource = readFileSync(resolve(process.cwd(), 'src/routes/admin-sla-alerts.ts'), 'utf8')
const appSource = readFileSync(resolve(process.cwd(), 'src/app.ts'), 'utf8')
const schemaSource = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8')
const migrationSource = readFileSync(resolve(process.cwd(), 'prisma/migrations/20260624230000_add_sla_alert_center/migration.sql'), 'utf8')
const adminApiSource = readFileSync(resolve(process.cwd(), '../client/src/api/admin.ts'), 'utf8')
const userApiSource = readFileSync(resolve(process.cwd(), '../client/src/api/index.ts'), 'utf8')
const adminRouterSource = readFileSync(resolve(process.cwd(), '../client/src/router/admin.ts'), 'utf8')
const adminNavSource = readFileSync(resolve(process.cwd(), '../client/src/config/side-nav-items-admin.ts'), 'utf8')
const alertViewSource = readFileSync(resolve(process.cwd(), '../client/src/views/admin/SlaAlertsView.vue'), 'utf8')
const typesSource = readFileSync(resolve(process.cwd(), '../client/src/types/api.ts'), 'utf8')

assert.ok(
  appSource.includes("import adminSlaAlertsRoutes from './routes/admin-sla-alerts.js'") &&
    appSource.includes("fastify.register(adminSlaAlertsRoutes, { prefix: '/api/admin/sla-alerts' })"),
  'SLA alert routes must be registered under /api/admin/sla-alerts'
)

assert.ok(
  routeSource.includes("fastify.get('/overview'") &&
    routeSource.includes("fastify.get<{ Querystring: AlertQuery }>('/alerts'") &&
    routeSource.includes("fastify.get('/rules'") &&
    routeSource.includes("fastify.post('/scan'") &&
    routeSource.includes("fastify.post<{ Params: RouteIdParams; Body: AlertActionBody }>('/alerts/:id/acknowledge'") &&
    routeSource.includes("fastify.post<{ Params: RouteIdParams; Body: AlertActionBody }>('/alerts/:id/resolve'") &&
    routeSource.includes("fastify.post<{ Params: RouteIdParams; Body: AlertActionBody }>('/alerts/:id/silence'") &&
    routeSource.includes("fastify.patch<{ Params: { code: string }; Body: RuleUpdateBody }>('/rules/:code'") &&
    routeSource.match(/onRequest:\s*\[fastify\.authenticateAdmin\]/g)?.length === 8,
  'SLA alert APIs must expose overview/alerts/rules/scan/actions and require authenticateAdmin'
)

assert.ok(
  schemaSource.includes('enum SlaAlertSeverity') &&
    schemaSource.includes('enum SlaAlertStatus') &&
    schemaSource.includes('model SlaAlertRule') &&
    schemaSource.includes('model SlaAlertEvent') &&
    schemaSource.includes('model SlaAlertAction') &&
    schemaSource.includes('@@unique([ruleCode, fingerprint])') &&
    migrationSource.includes('CREATE TYPE "SlaAlertSeverity"') &&
    migrationSource.includes('CREATE TABLE "sla_alert_rules"') &&
    migrationSource.includes('CREATE TABLE "sla_alert_events"') &&
    migrationSource.includes('CREATE TABLE "sla_alert_actions"') &&
    migrationSource.includes('sla_alert_events_rule_code_fingerprint_key'),
  'SLA alert rules, events, actions and dedupe index must be persisted with migration coverage'
)

assert.ok(
  routeSource.includes("'host.offline'") &&
    routeSource.includes("'agent.offline'") &&
    routeSource.includes("'agent.heartbeat_stale'") &&
    routeSource.includes("'instance.task_failed'") &&
    routeSource.includes("'payment.order_failed'") &&
    routeSource.includes("'notification.failed'") &&
    routeSource.includes("'smtp.failed'") &&
    routeSource.includes("'ota.failed'"),
  'SLA alert scan must cover host, agent, delivery, payment, notification, SMTP and OTA failures'
)

assert.ok(
  routeSource.includes('sanitizeTokensInString') &&
    routeSource.includes('upsertDetection') &&
    routeSource.includes('ruleCode_fingerprint') &&
    routeSource.includes('triggerCount: { increment: 1 }') &&
    routeSource.includes("actionType: { in: ['detected', 'merged'] }") &&
    !routeSource.includes('callbackData') &&
    !routeSource.includes('providerConfigSnapshot') &&
    !routeSource.includes('certPath') &&
    !routeSource.includes('keyPath') &&
    !routeSource.includes('installToken') &&
    !routeSource.includes('secretEncrypted'),
  'SLA alerts must sanitize text, dedupe by fingerprint, track actions, and avoid sensitive source fields'
)

assert.ok(
  adminApiSource.includes('SlaAlertOverview') &&
    adminApiSource.includes('SlaAlertListResponse') &&
    adminApiSource.includes('SlaAlertScanResponse') &&
    adminApiSource.includes('slaAlerts: {') &&
    adminApiSource.includes("http.get('/admin/sla-alerts/overview')") &&
    adminApiSource.includes("http.post('/admin/sla-alerts/scan'") &&
    adminApiSource.includes("http.post(`/admin/sla-alerts/alerts/${id}/acknowledge`") &&
    adminApiSource.includes("http.patch(`/admin/sla-alerts/rules/${encodeURIComponent(code)}`") &&
    !userApiSource.includes('/admin/sla-alerts'),
  'SLA alert API client must exist only in the admin client'
)

assert.ok(
  adminRouterSource.includes("path: '/admin/sla-alerts'") &&
    adminRouterSource.includes("name: 'admin-sla-alerts'") &&
    adminRouterSource.includes("requiresAdmin: true") &&
    adminNavSource.includes("path: '/admin/sla-alerts'") &&
    adminNavSource.includes("label: 'nav.slaAlerts'"),
  'SLA alert page must be reachable only through admin router and admin navigation'
)

assert.ok(
  typesSource.includes('export type SlaAlertSeverity') &&
    typesSource.includes('export interface SlaAlertEvent') &&
    typesSource.includes('export interface SlaAlertRule') &&
    alertViewSource.includes('SLA 与告警') &&
    alertViewSource.includes('api.slaAlerts.overview()') &&
    alertViewSource.includes('api.slaAlerts.scan()') &&
    alertViewSource.includes("runAlertAction('acknowledge')") &&
    alertViewSource.includes("runAlertAction('recovered')") &&
    alertViewSource.includes("runAlertAction('ignored')") &&
    alertViewSource.includes("runAlertAction('silence')") &&
    alertViewSource.includes('toggleRule(rule)'),
  'SLA alert view must render overview, scan, actions, rules and typed data'
)

console.log('SLA alert guard tests passed')
