import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const routeSource = readFileSync(resolve(process.cwd(), 'src/routes/admin-delivery.ts'), 'utf8')
const instancesSource = readFileSync(resolve(process.cwd(), 'src/routes/instances.ts'), 'utf8')
const managedProvisionSource = readFileSync(resolve(process.cwd(), 'src/lib/managed-instance-provision.ts'), 'utf8')
const appSource = readFileSync(resolve(process.cwd(), 'src/app.ts'), 'utf8')
const schemaSource = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8')
const migrationSource = readFileSync(resolve(process.cwd(), 'prisma/migrations/20260624222000_add_delivery_assurance_cases/migration.sql'), 'utf8')
const upgradeSyncMigrationSource = readFileSync(resolve(process.cwd(), 'prisma/migrations/20260627070000_add_plan_upgrade_sync_delivery_case/migration.sql'), 'utf8')
const adminApiSource = readFileSync(resolve(process.cwd(), '../client/src/api/admin.ts'), 'utf8')
const adminRouterSource = readFileSync(resolve(process.cwd(), '../client/src/router/admin.ts'), 'utf8')
const adminNavSource = readFileSync(resolve(process.cwd(), '../client/src/config/side-nav-items-admin.ts'), 'utf8')
const sideNavSource = readFileSync(resolve(process.cwd(), '../client/src/components/layout/SideNav.vue'), 'utf8')
const deliveryViewSource = readFileSync(resolve(process.cwd(), '../client/src/views/admin/DeliveryCenterView.vue'), 'utf8')
const userApiSource = readFileSync(resolve(process.cwd(), '../client/src/api/index.ts'), 'utf8')
const workerSource = readFileSync(resolve(process.cwd(), 'src/workers/instanceTaskWorker.ts'), 'utf8')
const notifierSource = readFileSync(resolve(process.cwd(), 'src/lib/notifier.ts'), 'utf8')

const managedSuccessStart = managedProvisionSource.indexOf('    await markFlashSaleDelivered(instanceId)')
const managedFailureStart = managedProvisionSource.indexOf(
  '  } catch (error) {\n    console.error(`[Managed Provisioning] instance',
  managedSuccessStart
)
const managedSuccessSection = managedProvisionSource.slice(managedSuccessStart, managedFailureStart)

assert.ok(
  managedSuccessStart > managedProvisionSource.indexOf('if (updateResult.count === 0)') &&
    managedSuccessSection.match(/markFlashSaleDelivered\(instanceId\)/g)?.length === 1 &&
    !managedSuccessSection.includes('soldCount') &&
    managedSuccessSection.includes("type: 'inet4'") &&
    managedSuccessSection.includes("device: 'eth0'") &&
    managedSuccessSection.includes("type: 'inet6'") &&
    managedSuccessSection.includes("device: 'eth1'") &&
    managedSuccessSection.includes('db.getInstanceById(instanceId).catch') &&
    managedSuccessSection.includes("sendNotification(instance.user_id, 'instance_created'") &&
    managedSuccessSection.includes('sendInstanceCreatedEmail(user.email') &&
    managedSuccessSection.includes("event: 'service.provisioned'") &&
    managedSuccessSection.includes('userId: instance.user_id'),
  'managed provisioning success must record IPs, notify and email the target user, emit service.provisioned, and mark flash-sale delivery once without incrementing soldCount'
)

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
    routeSource.includes("fastify.get<{ Querystring: DeliveryQuery }>('/cases'") &&
    routeSource.includes("fastify.post<{ Params: RouteIdParams; Body: CaseActionBody }>('/cases/:id/retry-sync'") &&
    routeSource.includes("fastify.post<{ Params: RouteIdParams; Body: CaseActionBody }>('/cases/:id/resolve'") &&
    routeSource.match(/onRequest:\s*\[fastify\.authenticateAdmin\]/g)?.length === 9,
  'delivery center APIs must expose overview/tasks/actions and require authenticateAdmin'
)

assert.ok(
  schemaSource.includes('enum DeliveryAssuranceCaseStatus') &&
    schemaSource.includes('model DeliveryAssuranceCase') &&
    schemaSource.includes('model DeliveryAssuranceAction') &&
    schemaSource.includes('plan_upgrade_sync_failed') &&
    migrationSource.includes('CREATE TYPE "DeliveryAssuranceCaseStatus"') &&
    migrationSource.includes('CREATE TABLE "delivery_assurance_cases"') &&
    migrationSource.includes('CREATE UNIQUE INDEX "delivery_assurance_cases_task_id_key"') &&
    upgradeSyncMigrationSource.includes('ALTER TYPE "DeliveryAssuranceIssueType" ADD VALUE IF NOT EXISTS') &&
    upgradeSyncMigrationSource.includes('plan_upgrade_sync_failed'),
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
  instancesSource.includes('await recordInitialProvisioningFailureCase({') &&
    instancesSource.includes('compensationClaimed: compensationResult.claimed') &&
    instancesSource.includes('refundStatus: compensationResult.refundStatus') &&
    routeSource.includes("source: 'initial_instance_provisioning'") &&
    routeSource.includes("taskId: null") &&
    routeSource.includes('instanceId: input.instanceId') &&
    routeSource.includes('await advisoryTransactionLock(tx, INSTANCE_OPERATION_LOCK_NAMESPACE, input.instanceId)') &&
    routeSource.includes('const existing = await tx.deliveryAssuranceCase.findFirst({') &&
    routeSource.includes("title: { startsWith: '初始开通失败：' }") &&
    routeSource.includes('if (existing) return existing') &&
    routeSource.includes("{ issueType: 'task_failed', title: { startsWith: '初始开通失败：' } }") &&
    routeSource.includes("deliveryCase.title.startsWith('初始开通失败：')"),
  'initial createInstanceAsync failures must open one instance-linked delivery assurance case with compensation status'
)

assert.ok(
  adminApiSource.includes('DeliveryOverview') &&
    adminApiSource.includes('DeliveryTasksResponse') &&
    adminApiSource.includes('DeliveryAssuranceCase') &&
    adminApiSource.includes('delivery: {') &&
    adminApiSource.includes("http.get('/admin/delivery/overview')") &&
    adminApiSource.includes("http.get('/admin/delivery/tasks', { params })") &&
    adminApiSource.includes("http.get('/admin/delivery/cases', { params })") &&
    adminApiSource.includes("http.post(`/admin/delivery/tasks/${taskId}/takeover`") &&
    adminApiSource.includes("http.post(`/admin/delivery/tasks/${taskId}/retry`") &&
    adminApiSource.includes("http.post(`/admin/delivery/tasks/${taskId}/notify`") &&
    adminApiSource.includes("http.post(`/admin/delivery/tasks/${taskId}/resolve`") &&
    adminApiSource.includes("http.post(`/admin/delivery/cases/${caseId}/retry-sync`") &&
    adminApiSource.includes("http.post(`/admin/delivery/cases/${caseId}/resolve`") &&
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
    deliveryViewSource.includes('升级同步修复') &&
    deliveryViewSource.includes("runRepairCaseAction(item, 'retry-sync')") &&
    deliveryViewSource.includes('formatAgent(selectedTask)') &&
    deliveryViewSource.includes('formatAmount(selectedTask.billing?.amount)') &&
    deliveryViewSource.includes('/admin/instances/${selectedTask.instanceId}'),
  'delivery center view must render task overview, assurance actions, operational context, and instance drill-down'
)

assert.ok(
  deliveryViewSource.match(/class="space-y-3 p-4 lg:hidden"/g)?.length === 2 &&
    deliveryViewSource.match(/class="hidden overflow-hidden lg:block"/g)?.length === 2 &&
    deliveryViewSource.includes('table class="w-full table-fixed text-left text-sm"') &&
    deliveryViewSource.includes('table class="w-full table-fixed text-left text-sm"') &&
    !deliveryViewSource.includes('<div class="overflow-x-auto">') &&
    !deliveryViewSource.includes('table class="min-w-full text-left text-sm"'),
  'delivery center must use mobile cards and fixed desktop tables instead of mobile horizontal table scrolling'
)

assert.ok(
  deliveryViewSource.includes('@click="runRepairCaseAction(item, \'retry-sync\')"') &&
    deliveryViewSource.includes('@click="runRepairCaseAction(item, \'recovered\')"') &&
    deliveryViewSource.includes('@click="runRepairCaseAction(item, \'closed\')"') &&
    deliveryViewSource.includes('@click="selectedTaskId = task.id"') &&
    deliveryViewSource.includes(':class="selectedTaskId === task.id ?') &&
    deliveryViewSource.includes('@click="goRepairPage(repairPage - 1)"') &&
    deliveryViewSource.includes('@click="goPage(page - 1)"'),
  'delivery center responsive layout must preserve repair actions, task selection, and pagination controls'
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
