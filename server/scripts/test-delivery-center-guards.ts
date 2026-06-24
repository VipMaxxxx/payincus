import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const routeSource = readFileSync(resolve(process.cwd(), 'src/routes/admin-delivery.ts'), 'utf8')
const appSource = readFileSync(resolve(process.cwd(), 'src/app.ts'), 'utf8')
const adminApiSource = readFileSync(resolve(process.cwd(), '../client/src/api/admin.ts'), 'utf8')
const adminRouterSource = readFileSync(resolve(process.cwd(), '../client/src/router/admin.ts'), 'utf8')
const adminNavSource = readFileSync(resolve(process.cwd(), '../client/src/config/side-nav-items-admin.ts'), 'utf8')
const deliveryViewSource = readFileSync(resolve(process.cwd(), '../client/src/views/admin/DeliveryCenterView.vue'), 'utf8')
const workerSource = readFileSync(resolve(process.cwd(), 'src/workers/instanceTaskWorker.ts'), 'utf8')

assert.ok(
  appSource.includes("import adminDeliveryRoutes from './routes/admin-delivery.js'") &&
    appSource.includes("fastify.register(adminDeliveryRoutes, { prefix: '/api/admin/delivery' })"),
  'admin delivery routes must be registered under /api/admin/delivery'
)

assert.ok(
  routeSource.includes("fastify.get('/overview'") &&
    routeSource.includes("fastify.get<{ Querystring: DeliveryQuery }>('/tasks'") &&
    routeSource.match(/onRequest:\s*\[fastify\.authenticateAdmin\]/g)?.length === 2,
  'delivery center APIs must expose overview/tasks and require authenticateAdmin'
)

assert.ok(
  routeSource.includes('select: { id: true, username: true, email: true, status: true }') &&
    routeSource.includes('select: { id: true, name: true, status: true, location: true, countryCode: true }') &&
    !routeSource.includes('rootPassword') &&
    !routeSource.includes('certPath') &&
    !routeSource.includes('keyPath') &&
    !routeSource.includes('installToken') &&
    !routeSource.includes('passwordHash'),
  'delivery center responses must use explicit safe selects and avoid sensitive fields'
)

assert.ok(
  adminApiSource.includes('DeliveryOverview') &&
    adminApiSource.includes('DeliveryTasksResponse') &&
    adminApiSource.includes('delivery: {') &&
    adminApiSource.includes("http.get('/admin/delivery/overview')") &&
    adminApiSource.includes("http.get('/admin/delivery/tasks', { params })"),
  'admin API client must expose delivery center endpoints only in the admin client'
)

assert.ok(
  adminRouterSource.includes("path: '/admin/delivery'") &&
    adminRouterSource.includes("name: 'admin-delivery'") &&
    adminRouterSource.includes("requiresAdmin: true") &&
    adminNavSource.includes("path: '/admin/delivery'") &&
    adminNavSource.includes("label: 'nav.delivery'"),
  'admin delivery center must be reachable from admin router and navigation'
)

assert.ok(
  deliveryViewSource.includes('交付保障') &&
    deliveryViewSource.includes('api.delivery.overview()') &&
    deliveryViewSource.includes('api.delivery.tasks({') &&
    deliveryViewSource.includes('/admin/instances/${selectedTask.instanceId}'),
  'delivery center view must render task overview, task list, and instance drill-down'
)

assert.ok(
  workerSource.includes('async function notifyInstanceTaskFailure(') &&
    workerSource.includes('系统启动清理超时任务') &&
    workerSource.includes('任务执行超时') &&
    workerSource.includes("sendNotification(task.userId, 'instance_task_failed'"),
  'instance task worker must notify users for direct failures and timeout cleanup failures'
)

console.log('delivery center guard tests passed')
