import { readFileSync } from 'fs'
import { resolve } from 'path'
import assert from 'node:assert/strict'

const root = resolve(process.cwd(), '..')
const schema = readFileSync(resolve(root, 'server/prisma/schema.prisma'), 'utf8')
const route = readFileSync(resolve(root, 'server/src/routes/admin-capacity-cost.ts'), 'utf8')
const app = readFileSync(resolve(root, 'server/src/app.ts'), 'utf8')
const adminApi = readFileSync(resolve(root, 'client/src/api/admin.ts'), 'utf8')
const userApi = readFileSync(resolve(root, 'client/src/api/index.ts'), 'utf8')
const adminRouter = readFileSync(resolve(root, 'client/src/router/admin.ts'), 'utf8')
const adminNav = readFileSync(resolve(root, 'client/src/config/side-nav-items-admin.ts'), 'utf8')
const view = readFileSync(resolve(root, 'client/src/views/admin/CapacityCostView.vue'), 'utf8')
const viteConfig = readFileSync(resolve(root, 'client/vite.config.ts'), 'utf8')
const packagesRoute = readFileSync(resolve(root, 'server/src/routes/packages.ts'), 'utf8')
const instanceWorker = readFileSync(resolve(root, 'server/src/workers/instanceTaskWorker.ts'), 'utf8')

assert.ok(
  schema.includes('model HostCostProfile') &&
    schema.includes('monthlyCost') &&
    schema.includes('ipv4MonthlyCost') &&
    schema.includes('trafficTbCost') &&
    schema.includes('model CapacitySnapshot') &&
    schema.includes('@@unique([hostId, capturedDate])'),
  'capacity cost feature must persist host cost profiles and idempotent daily capacity snapshots'
)

assert.ok(
  app.includes("import adminCapacityCostRoutes from './routes/admin-capacity-cost.js'") &&
    app.includes("fastify.register(adminCapacityCostRoutes, { prefix: '/api/admin/capacity-cost' })"),
  'capacity cost routes must be registered under the admin API prefix'
)

assert.ok(
  route.includes("onRequest: [app.authenticate, app.requireAdmin]") &&
    route.includes("app.get('/overview'") &&
    route.includes("('/hosts/:id/cost-profile'") &&
    route.includes('prisma.hostCostProfile.upsert') &&
    route.includes('capacity.cost_profile.update'),
  'capacity cost overview and cost updates must be admin-only and log cost changes'
)

assert.ok(
  route.includes('estimatePlanSlots') &&
    route.includes('estimatePlanMonthlyCost') &&
    route.includes('cpuAvailable') &&
    route.includes('memoryAvailable') &&
    route.includes('diskAvailable') &&
    route.includes('natPortAvailable') &&
    route.includes('estimatedMarginMonthly') &&
    route.includes('availableSlots'),
  'capacity cost overview must compute sellable inventory and plan margin estimates'
)

assert.ok(
  route.includes('prisma.capacitySnapshot.upsert') &&
    route.includes('hostId_capturedDate') &&
    route.includes('capturedDate: today'),
  'capacity snapshots must be written idempotently per host and day'
)

assert.ok(
  route.includes("CAPACITY_SLA_RULE_CODE = 'capacity.host_pressure'") &&
    route.includes('syncHostCapacityAlertsToSla') &&
    route.includes('prisma.slaAlertRule.upsert') &&
    route.includes('prisma.slaAlertEvent.findUnique') &&
    route.includes('ruleCode_fingerprint') &&
    route.includes("objectType: 'host' as const") &&
    route.includes("source: 'capacity-cost-overview'") &&
    route.includes('prisma.slaAlertAction.create'),
  'host capacity alerts must be integrated with SLA alert events without introducing user-visible fields'
)

assert.ok(
  adminApi.includes('/admin/capacity-cost/overview') &&
    adminApi.includes('/admin/capacity-cost/hosts/${hostId}/cost-profile') &&
    adminRouter.includes("path: '/admin/capacity-cost'") &&
    adminNav.includes("path: '/admin/capacity-cost'") &&
    view.includes('容量与成本') &&
    view.includes('套餐毛利估算') &&
    view.includes('只做运营提示，不自动停售或修改套餐'),
  'admin UI must expose a dedicated capacity and cost page'
)

assert.ok(
  !userApi.includes('/admin/capacity-cost') &&
    !userApi.includes('estimatedMarginMonthly') &&
    !userApi.includes('monthlyCost') &&
    viteConfig.includes("'capacityCost'") &&
    !packagesRoute.includes('costProfile') &&
    !packagesRoute.includes('estimatedMarginMonthly'),
  'user APIs and public package routes must not expose capacity cost or margin fields'
)

assert.ok(
  !instanceWorker.includes('hostCostProfile') &&
    !instanceWorker.includes('capacitySnapshot') &&
    !packagesRoute.includes('hostCostProfile.upsert') &&
    !packagesRoute.includes('capacitySnapshot.upsert'),
  'capacity cost feature must not alter instance provisioning or package selling paths'
)

console.log('capacity cost guard tests passed')
