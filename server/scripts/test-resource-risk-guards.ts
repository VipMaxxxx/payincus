import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(repoRoot, path), 'utf8')

const schema = read('server/prisma/schema.prisma')
const migration = read('server/prisma/migrations/20260627043000_add_instance_resource_risk_center/migration.sql')
const incusTraffic = read('server/src/lib/incus/incus-traffic.ts')
const trafficCollector = read('server/src/services/instance-traffic-collector.ts')
const riskService = read('server/src/services/resource-risk.ts')
const restrictionService = read('server/src/services/user-order-restrictions.ts')
const riskRoute = read('server/src/routes/resource-risk.ts')
const instanceRoute = read('server/src/routes/instances.ts')
const app = read('server/src/app.ts')
const clientApi = read('client/src/api/index.ts')
const adminApi = read('client/src/api/admin.ts')
const adminRouter = read('client/src/router/admin.ts')
const adminNav = read('client/src/config/side-nav-items-admin.ts')
const adminView = read('client/src/views/admin/ResourceRiskView.vue')
const createView = read('client/src/views/InstanceCreateView.vue')
const zhLocale = read('client/src/locales/zh-CN.ts')
const enLocale = read('client/src/locales/en.ts')

assert(
  schema.includes('model ResourceRiskPolicy') &&
    schema.includes('model InstanceRiskState') &&
    schema.includes('model InstanceResourceSample') &&
    schema.includes('model InstanceRiskEvent') &&
    schema.includes('model UserOrderRestriction') &&
    schema.includes('rxPacketsRaw') &&
    schema.includes('cpuUsageRaw') &&
    schema.includes('orderRestrictScore') &&
    schema.includes('autoSuspendScore') &&
    schema.includes('autoSuspendEnabled') &&
    migration.includes('CREATE TABLE IF NOT EXISTS "instance_risk_states"') &&
    migration.includes('CREATE TABLE IF NOT EXISTS "instance_resource_samples"') &&
    migration.includes('CREATE TABLE IF NOT EXISTS "user_order_restrictions"') &&
    migration.includes('"order_restrict_score"') &&
    migration.includes('"auto_suspend_score"') &&
    migration.includes('"auto_suspend_enabled"'),
  'resource risk schema and migration must persist policy, instance scores, samples, events, order restrictions, packets, and CPU snapshots'
)

assert(
  incusTraffic.includes('rxPackets: bigint') &&
    incusTraffic.includes('txPackets: bigint') &&
    incusTraffic.includes('cpuUsageRaw: bigint | null') &&
    incusTraffic.includes('state.cpu?.usage') &&
    trafficCollector.includes('instanceResourceSample.create') &&
    trafficCollector.includes('rxPacketsDelta') &&
    trafficCollector.includes('cpuPercent') &&
    trafficCollector.includes('totalMbps'),
  'traffic collector must record resource-risk samples without replacing monthly traffic accounting'
)

assert(
  riskService.includes('export async function evaluateInstanceRisk') &&
    riskService.includes('bandwidth_sustained') &&
    riskService.includes('cpu_sustained') &&
    riskService.includes('packet_anomaly') &&
    riskService.includes('scan_suspected') &&
    riskService.includes('restoreBandwidth(client, input.instance.incusId, limit, limit)') &&
    riskService.includes('accountOrderRestrictEnabled') &&
    riskService.includes('autoSuspendEnabled') &&
    riskService.includes('restrictUserOrdersForRisk') &&
    riskService.includes('export async function manualLimitInstanceRisk') &&
    riskService.includes('export async function manualSuspendInstanceRisk') &&
    riskService.includes('export async function manualUnsuspendInstanceRisk') &&
    riskService.includes('export async function manualRestrictOrdersForInstanceRisk') &&
    riskService.includes('export async function simulateResourceRiskPolicy') &&
    riskService.includes('recoverScore') &&
    riskService.includes('minDurationMinutes') &&
    riskService.includes('cooldownMinutes') &&
    riskService.includes('allowFurtherDowngrade') &&
    riskService.includes('manual_state_preserved') &&
    riskService.includes('qos_recovered') &&
    riskService.includes('resource_risk_qos_limited') &&
    riskService.includes("type: 'manual_suspend'") &&
    riskService.includes("type: 'manual_qos_limited'") &&
    riskService.includes('startResourceRiskScheduler'),
  'resource risk service must evaluate bandwidth, CPU, packet anomaly, scan signals, apply QoS, recover/cool down tiers, preserve manual actions, simulate policy impact, restrict orders, and run on a scheduler'
)

assert(
  restrictionService.includes('assertUserCanCreateInstance') &&
    restrictionService.includes('OrderRestrictedError') &&
    restrictionService.includes('ORDER_RESTRICTED_BY_RISK') &&
    instanceRoute.includes('await assertUserCanCreateInstance(user.id)') &&
    instanceRoute.includes('orderRestrictionApiError(error)'),
  'user instance creation must be blocked when the account has an active instance-risk order restriction'
)

assert(
  riskRoute.includes("'/resource-risk/my-status'") &&
    riskRoute.includes("'/resource-risk/review-ticket'") &&
    riskRoute.includes("'/admin/resource-risk/policy'") &&
    riskRoute.includes("'/admin/resource-risk/policy/simulate'") &&
    riskRoute.includes("'/admin/resource-risk/instances'") &&
    riskRoute.includes("'/admin/resource-risk/instances/:id/evidence'") &&
    riskRoute.includes("'/admin/resource-risk/instances/:id/manual-qos'") &&
    riskRoute.includes("'/admin/resource-risk/instances/:id/manual-suspend'") &&
    riskRoute.includes("'/admin/resource-risk/instances/:id/manual-unsuspend'") &&
    riskRoute.includes("'/admin/resource-risk/instances/:id/manual-order-restrict'") &&
    riskRoute.includes("'/admin/resource-risk/order-restrictions/:id/release'") &&
    riskRoute.includes('parseQosTiers(body.qosTiers)') &&
    riskRoute.includes('recoverScore >= score') &&
    riskRoute.includes('simulateResourceRiskPolicy') &&
    riskRoute.includes('activeOrderRestriction') &&
    riskRoute.includes('activeAccountOrderRestriction') &&
    riskRoute.includes('sourceInstanceId: true') &&
    riskRoute.includes('restriction.sourceInstanceId === item.instanceId') &&
    riskRoute.includes('restrictionByUserId') &&
    riskRoute.includes('instanceResourceSample.findMany') &&
    riskRoute.includes('buildResourceTrend') &&
    riskRoute.includes('hourly24h') &&
    riskRoute.includes('daily7d') &&
    riskRoute.includes("action: { startsWith: 'resource_risk.' }") &&
    app.includes("await fastify.register(resourceRiskRoutes, { prefix: '/api' })") &&
    app.includes('startResourceRiskScheduler()') &&
    riskService.includes('autoSuspendInstance') &&
    riskService.includes('policy.autoSuspendScore') &&
    riskService.includes('policy.orderRestrictScore'),
  'resource risk user and admin APIs, policy simulation, and scheduler must be registered and start with the app'
)

assert(
    adminApi.includes('resourceRisk:') &&
    adminApi.includes("http.get('/admin/resource-risk/overview')") &&
    adminApi.includes("http.put('/admin/resource-risk/policy'") &&
    adminApi.includes("http.post('/admin/resource-risk/policy/simulate'") &&
    adminApi.includes('ResourceRiskSimulationResult') &&
    adminApi.includes('manualQos') &&
    adminApi.includes('manualSuspend') &&
    adminApi.includes('manualUnsuspend') &&
    adminApi.includes('manualOrderRestrict') &&
    adminApi.includes('ResourceRiskEvidenceDetail') &&
    adminApi.includes('ResourceRiskTrendBucket') &&
    adminApi.includes('evidence: (id: number): Promise<ResourceRiskEvidenceDetail>') &&
    clientApi.includes('createReviewTicket') &&
    adminRouter.includes("path: '/admin/resource-risk'") &&
    adminNav.includes("path: '/admin/resource-risk'") &&
    adminView.includes('实例风险') &&
    adminView.includes('事件流水') &&
    adminView.includes('下单限制') &&
    adminView.includes('QoS 档位') &&
    adminView.includes('policyForm.qosTiers') &&
    adminView.includes('recoverScore') &&
    adminView.includes('minDurationMinutes') &&
    adminView.includes('cooldownMinutes') &&
    adminView.includes('allowFurtherDowngrade') &&
    adminView.includes('notifyUser') &&
    adminView.includes('restrictOrders') &&
    adminView.includes('simulatePolicy') &&
    adminView.includes('策略试运行结果') &&
    adminView.includes('会限速') &&
    adminView.includes('addQosTier') &&
    adminView.includes('manualSuspend(item)') &&
    adminView.includes('manualAction') &&
    adminView.includes('submitManualAction') &&
    adminView.includes('manualConfirmChecked') &&
    adminView.includes('确认本次操作会写入资源风控事件和后台审计') &&
    adminView.includes('pageSize: 10') &&
    adminView.includes('changeInstancesPage') &&
    adminView.includes('changeEventsPage') &&
    adminView.includes('changeRestrictionsPage') &&
    adminView.includes('res.items.length === 0') &&
    adminView.includes('await loadRestrictions(nextTotalPages)') &&
    adminView.includes('解除封禁') &&
    adminView.includes('解除限单') &&
    adminView.includes('账号已限单') &&
    adminView.includes('hasActiveOrderRestriction(item)') &&
    adminView.includes('hasOtherActiveOrderRestriction(item)') &&
    adminView.includes('releaseOrderRestrictionFromState(item)') &&
    adminView.includes('openEvidence(item)') &&
    adminView.includes('风险证据详情') &&
    adminView.includes('resource-risk-evidence-panel') &&
    adminView.includes('resource-risk-evidence-surface') &&
    adminView.includes('resource-risk-evidence-code') &&
    adminView.includes('background-color: #ffffff') &&
    adminView.includes('当前证据快照') &&
    adminView.includes('最近资源样本') &&
    adminView.includes('24 小时趋势') &&
    adminView.includes('7 天趋势') &&
    adminView.includes('formatTrendBucket') &&
    adminView.includes('风险事件时间线') &&
    adminView.includes('处置审计') &&
    adminView.includes('关联下单限制') &&
    adminView.includes('stringifyEvidence') &&
    adminView.includes('manualReasonTemplates') &&
    adminView.includes('applyManualReasonTemplate') &&
    adminView.includes('原因模板') &&
    adminView.includes('exportEvidenceDetail') &&
    adminView.includes('导出 JSON') &&
    !adminView.includes('qosTiersText') &&
    !adminView.includes('window.prompt') &&
    !adminView.includes('window.confirm') &&
    !clientApi.includes('/admin/resource-risk/instances/${id}/evidence') &&
    createView.includes('orderRiskReviewAvailable') &&
    createView.includes('activeOrderRiskRestriction') &&
    createView.includes('api.resourceRisk.getMyStatus()') &&
    createView.includes('api.resourceRisk.createReviewTicket') &&
    zhLocale.includes('ORDER_RESTRICTED_BY_RISK') &&
    enLocale.includes('ORDER_RESTRICTED_BY_RISK'),
  'admin UI and user create-page review flow must expose the resource risk center'
)

assert(
  !schema.includes('userRiskScore') &&
    !schema.includes('accountRiskScore') &&
    riskService.includes('instanceRiskState') &&
    riskService.includes('sourceInstanceId'),
  'risk scores must stay instance-scoped; accounts are restricted only through source instance linkage'
)

console.log('resource risk guards passed')
