import { readFileSync } from 'fs'
import { resolve } from 'path'
import assert from 'node:assert/strict'

function includes(source: string, pattern: string, label: string): void {
  assert.ok(source.includes(pattern), `Missing ${label}: ${pattern}`)
}

function excludes(source: string, pattern: string, label: string): void {
  assert.ok(!source.includes(pattern), `Unexpected ${label}: ${pattern}`)
}

const repoRoot = resolve(new URL('../..', import.meta.url).pathname)
const hostsSource = readFileSync(resolve(repoRoot, 'server/src/db/hosts.ts'), 'utf8')
const paginationSource = readFileSync(resolve(repoRoot, 'server/src/db/pagination.ts'), 'utf8')
const billingOpsSource = readFileSync(resolve(repoRoot, 'server/src/db/billing-operations.ts'), 'utf8')
const instanceBillingSource = readFileSync(resolve(repoRoot, 'server/src/routes/instance-billing.ts'), 'utf8')
const adminBillingSource = readFileSync(resolve(repoRoot, 'server/src/routes/admin-billing.ts'), 'utf8')
const changePlanModalSource = readFileSync(resolve(repoRoot, 'client/src/components/instance/modals/ChangePlanModal.vue'), 'utf8')
const adminBillingViewSource = readFileSync(resolve(repoRoot, 'client/src/views/admin/BillingView.vue'), 'utf8')
const apiTypesSource = readFileSync(resolve(repoRoot, 'client/src/types/api.ts'), 'utf8')
const repairServiceSource = readFileSync(resolve(repoRoot, 'server/src/services/plan-upgrade-sync-repair.ts'), 'utf8')
const deliveryRouteSource = readFileSync(resolve(repoRoot, 'server/src/routes/admin-delivery.ts'), 'utf8')
const deliveryViewSource = readFileSync(resolve(repoRoot, 'client/src/views/admin/DeliveryCenterView.vue'), 'utf8')
const adminApiSource = readFileSync(resolve(repoRoot, 'client/src/api/admin.ts'), 'utf8')

includes(hostsSource, 'export async function checkPlanUpgradeCapacity', 'non-locking upgrade capacity check')
includes(hostsSource, 'export async function reservePlanUpgradeCapacityWithLock', 'transactional upgrade capacity reservation')
includes(hostsSource, 'FOR UPDATE', 'host row lock for upgrade capacity reservation')
includes(hostsSource, "reason: 'cpu_insufficient'", 'CPU upgrade capacity reason')
includes(hostsSource, "reason: 'memory_insufficient'", 'memory upgrade capacity reason')
includes(hostsSource, "reason: 'disk_insufficient'", 'disk upgrade capacity reason')
includes(hostsSource, 'diskTotal <= 0 || (diskUsedEffective + disk) > diskTotal', 'disk check in host selection')
includes(paginationSource, '(host.diskUsedCalculated + disk) > diskTotal', 'disk check in available-hosts list')

includes(billingOpsSource, 'reservePlanUpgradeCapacityWithLock(tx, instance, newPlan)', 'user upgrade transactional reservation')
includes(billingOpsSource, 'limitsIngress: normalizedPlanTrafficLimitSpeed', 'user upgrade DB ingress update')
includes(billingOpsSource, 'limitsEgress: normalizedPlanTrafficLimitSpeed', 'user upgrade DB egress update')
includes(billingOpsSource, 'bandwidthLimit: normalizedPlanTrafficLimitSpeed', 'user upgrade bandwidth result')

includes(instanceBillingSource, 'db.checkPlanUpgradeCapacity(instance, newPlan)', 'user upgrade preview capacity check')
includes(instanceBillingSource, 'resourceCapacity: capacity', 'user upgrade preview capacity payload')
includes(instanceBillingSource, 'restoreBandwidth(client, instance.incusId, result.bandwidthLimit, result.bandwidthLimit)', 'user upgrade Incus bandwidth sync')
includes(instanceBillingSource, "source: 'user'", 'user upgrade sync failure repair source')
includes(instanceBillingSource, 'recordPlanUpgradeSyncFailure({', 'user upgrade sync failure repair case')
includes(instanceBillingSource, "code: 'HOST_RESOURCES_INSUFFICIENT'", 'user upgrade resource error code')
excludes(instanceBillingSource, 'host.cpu_used + cpuDelta', 'old post-upgrade user host counter increment')

includes(adminBillingSource, 'db.checkPlanUpgradeCapacity(instance, plan)', 'admin available plans capacity check')
includes(adminBillingSource, 'db.reservePlanUpgradeCapacityWithLock(tx, instance, newPlan)', 'admin upgrade transactional reservation')
includes(adminBillingSource, 'limitsIngress: normalizedPlanTrafficLimitSpeed', 'admin upgrade DB ingress update')
includes(adminBillingSource, 'limitsEgress: normalizedPlanTrafficLimitSpeed', 'admin upgrade DB egress update')
includes(adminBillingSource, 'restoreBandwidth(client, instance.incusId, normalizedPlanTrafficLimitSpeed, normalizedPlanTrafficLimitSpeed)', 'admin upgrade Incus bandwidth sync')
includes(adminBillingSource, "source: 'admin'", 'admin upgrade sync failure repair source')
includes(adminBillingSource, 'recordPlanUpgradeSyncFailure({', 'admin upgrade sync failure repair case')
includes(adminBillingSource, 'resourceWarnings: capacity.canUpgrade ? null', 'admin available plans resource warning')
excludes(adminBillingSource, 'instance.host.cpuUsed + cpuDelta', 'old post-upgrade admin host counter increment')

includes(repairServiceSource, "issueType: 'plan_upgrade_sync_failed'", 'plan upgrade sync repair issue type')
includes(repairServiceSource, 'patchInstanceResources(client, instance.incusId', 'repair retry resource patch')
includes(repairServiceSource, 'restoreBandwidth(client, instance.incusId, instance.limitsIngress, instance.limitsEgress)', 'repair retry bandwidth sync')
includes(repairServiceSource, "status: 'recovered'", 'repair retry recovered status')
includes(deliveryRouteSource, "fastify.get<{ Querystring: DeliveryQuery }>('/cases'", 'delivery repair cases list endpoint')
includes(deliveryRouteSource, "fastify.post<{ Params: RouteIdParams; Body: CaseActionBody }>('/cases/:id/retry-sync'", 'delivery repair retry endpoint')
includes(deliveryRouteSource, "fastify.post<{ Params: RouteIdParams; Body: CaseActionBody }>('/cases/:id/resolve'", 'delivery repair resolve endpoint')
includes(adminApiSource, 'retrySyncCase:', 'admin api repair retry method')
includes(adminApiSource, 'resolveCase:', 'admin api repair resolve method')
includes(deliveryViewSource, '升级同步修复', 'delivery center repair queue section')
includes(deliveryViewSource, "runRepairCaseAction(item, 'retry-sync')", 'delivery center repair retry action')

includes(apiTypesSource, 'resourceCapacity?:', 'client change plan capacity type')
includes(apiTypesSource, 'plan_upgrade_sync_failed', 'client delivery repair issue type')
includes(changePlanModalSource, 'preview.value.resourceWarnings?.[0]', 'user change plan capacity warning display')
includes(adminBillingViewSource, 'selectedUpgradePlanBlocked', 'admin upgrade blocked plan state')
includes(adminBillingViewSource, ':disabled="plan.canUpgrade === false"', 'admin upgrade disabled unavailable plan')

console.log('plan upgrade capacity guard checks passed')
