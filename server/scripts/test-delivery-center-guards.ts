import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const routeSource = readFileSync(resolve(process.cwd(), 'src/routes/admin-delivery.ts'), 'utf8')
const appSource = readFileSync(resolve(process.cwd(), 'src/app.ts'), 'utf8')
const schemaSource = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8')
const migrationSource = readFileSync(resolve(process.cwd(), 'prisma/migrations/20260624222000_add_delivery_assurance_cases/migration.sql'), 'utf8')
const adminApiSource = readFileSync(resolve(process.cwd(), '../client/src/api/admin.ts'), 'utf8')
const adminRouterSource = readFileSync(resolve(process.cwd(), '../client/src/router/admin.ts'), 'utf8')
const adminNavSource = readFileSync(resolve(process.cwd(), '../client/src/config/side-nav-items-admin.ts'), 'utf8')
const sideNavSource = readFileSync(resolve(process.cwd(), '../client/src/components/layout/SideNav.vue'), 'utf8')
const deliveryViewSource = readFileSync(resolve(process.cwd(), '../client/src/views/admin/DeliveryCenterView.vue'), 'utf8')
const userApiSource = readFileSync(resolve(process.cwd(), '../client/src/api/index.ts'), 'utf8')
const workerSource = readFileSync(resolve(process.cwd(), 'src/workers/instanceTaskWorker.ts'), 'utf8')
const notifierSource = readFileSync(resolve(process.cwd(), 'src/lib/notifier.ts'), 'utf8')

assert.ok(
  appSource.includes("import adminDeliveryRoutes from './routes/admin-delivery.js'") &&
    appSource.includes("fastify.register(adminDeliveryRoutes, { prefix: '/api/admin/delivery' })"),
  'admin delivery routes must be registered under /api/admin/delivery'
)

assert.ok(
  routeSource.includes("fastify.get('/overview'") &&
    routeSource.includes("fastify.get<{ Querystring: DeliveryQuery }>('/tasks'") &&
    routeSource.includes("fastify.post<{ Params: RouteIdParams; Body: CaseActionBody }>('/tasks/:id/takeover'") &&
    routeSource.includes("fastify.post<{ Params: RouteIdParams; Body: CaseActionBody }>('/tasks/:id/retry'") &&
    routeSource.includes("fastify.post<{ Params: RouteIdParams; Body: CaseActionBody }>('/tasks/:id/notify'") &&
    routeSource.includes("fastify.post<{ Params: RouteIdParams; Body: CaseActionBody }>('/tasks/:id/resolve'") &&
    routeSource.match(/onRequest:\s*\[fastify\.authenticateAdmin\]/g)?.length === 6,
  'delivery center APIs must expose overview/tasks/actions and require authenticateAdmin'
)

assert.ok(
  schemaSource.includes('enum DeliveryAssuranceCaseStatus') &&
    schemaSource.includes('model DeliveryAssuranceCase') &&
    schemaSource.includes('model DeliveryAssuranceAction') &&
    migrationSource.includes('CREATE TYPE "DeliveryAssuranceCaseStatus"') &&
    migrationSource.includes('CREATE TABLE "delivery_assurance_cases"') &&
    migrationSource.includes('CREATE UNIQUE INDEX "delivery_assurance_cases_task_id_key"'),
  'delivery assurance cases and action history must be persisted with migration coverage'
)

assert.ok(
  routeSource.includes('select: { id: true, username: true, email: true, status: true }') &&
    routeSource.includes('countryCode: true') &&
    routeSource.includes('cpuUsed: true') &&
    routeSource.includes('memoryUsed: true') &&
    routeSource.includes('agent: {') &&
    !routeSource.includes('rootPassword') &&
    !routeSource.includes('certPath') &&
    !routeSource.includes('keyPath') &&
    !routeSource.includes('installToken') &&
    !routeSource.includes('passwordHash'),
  'delivery center responses must use explicit safe selects and avoid sensitive fields'
)

assert.ok(
  routeSource.includes('sanitizeTokensInString') &&
    routeSource.includes("const IDEMPOTENT_RETRY_TASKS = new Set<InstanceTaskType>(['start', 'stop', 'restart'])") &&
    routeSource.includes('if (!IDEMPOTENT_RETRY_TASKS.has(task.taskType))') &&
    routeSource.includes('createInstanceTask({') &&
    routeSource.includes("addCaseAction(updated.id, 'retry'") &&
    routeSource.includes("sendNotification(task.userId, 'delivery_assurance_update'") &&
    routeSource.includes('casesPendingManual') &&
    routeSource.includes('casesAutoRetryable'),
  'delivery assurance must sanitize errors, restrict retry to idempotent tasks, notify users, and expose case status counts'
)

assert.ok(
  adminApiSource.includes('DeliveryOverview') &&
    adminApiSource.includes('DeliveryTasksResponse') &&
    adminApiSource.includes('DeliveryAssuranceCase') &&
    adminApiSource.includes('delivery: {') &&
    adminApiSource.includes("http.get('/admin/delivery/overview')") &&
    adminApiSource.includes("http.get('/admin/delivery/tasks', { params })") &&
    adminApiSource.includes("http.post(`/admin/delivery/tasks/${taskId}/takeover`") &&
    adminApiSource.includes("http.post(`/admin/delivery/tasks/${taskId}/retry`") &&
    adminApiSource.includes("http.post(`/admin/delivery/tasks/${taskId}/notify`") &&
    adminApiSource.includes("http.post(`/admin/delivery/tasks/${taskId}/resolve`") &&
    !userApiSource.includes('/admin/delivery'),
  'admin API client must expose delivery center endpoints only in the admin client'
)

assert.ok(
  adminRouterSource.includes("path: '/admin/delivery'") &&
    adminRouterSource.includes("name: 'admin-delivery'") &&
    adminRouterSource.includes("requiresAdmin: true") &&
    adminNavSource.includes("path: '/admin/delivery'") &&
    adminNavSource.includes("label: 'nav.delivery'") &&
    adminNavSource.includes("icon: 'pulse'") &&
    sideNavSource.includes("item.icon === 'pulse'"),
  'admin delivery center must be reachable from admin router and navigation'
)

assert.ok(
    deliveryViewSource.includes('交付保障') &&
    deliveryViewSource.includes('api.delivery.overview()') &&
    deliveryViewSource.includes('api.delivery.tasks({') &&
    deliveryViewSource.includes("runCaseAction('takeover')") &&
    deliveryViewSource.includes("runCaseAction('retry')") &&
    deliveryViewSource.includes("runCaseAction('notify')") &&
    deliveryViewSource.includes("runCaseAction('recovered')") &&
    deliveryViewSource.includes('formatAgent(selectedTask)') &&
    deliveryViewSource.includes('formatAmount(selectedTask.billing?.amount)') &&
    deliveryViewSource.includes('/admin/instances/${selectedTask.instanceId}'),
  'delivery center view must render task overview, assurance actions, operational context, and instance drill-down'
)

assert.ok(
  notifierSource.includes("| 'delivery_assurance_update'") &&
    notifierSource.includes('delivery_assurance_update:') &&
    notifierSource.includes('交付保障通知'),
  'delivery assurance user notifications must be available through notifier templates'
)

assert.ok(
  workerSource.includes('async function notifyInstanceTaskFailure(') &&
    workerSource.includes('系统启动清理超时任务') &&
    workerSource.includes('任务执行超时') &&
    workerSource.includes("sendNotification(task.userId, 'instance_task_failed'"),
  'instance task worker must notify users for direct failures and timeout cleanup failures'
)

console.log('delivery center guard tests passed')
