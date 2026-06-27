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
includes(instanceBillingSource, "code: 'HOST_RESOURCES_INSUFFICIENT'", 'user upgrade resource error code')
excludes(instanceBillingSource, 'host.cpu_used + cpuDelta', 'old post-upgrade user host counter increment')

includes(adminBillingSource, 'db.checkPlanUpgradeCapacity(instance, plan)', 'admin available plans capacity check')
includes(adminBillingSource, 'db.reservePlanUpgradeCapacityWithLock(tx, instance, newPlan)', 'admin upgrade transactional reservation')
includes(adminBillingSource, 'limitsIngress: normalizedPlanTrafficLimitSpeed', 'admin upgrade DB ingress update')
includes(adminBillingSource, 'limitsEgress: normalizedPlanTrafficLimitSpeed', 'admin upgrade DB egress update')
includes(adminBillingSource, 'restoreBandwidth(client, instance.incusId, normalizedPlanTrafficLimitSpeed, normalizedPlanTrafficLimitSpeed)', 'admin upgrade Incus bandwidth sync')
includes(adminBillingSource, 'resourceWarnings: capacity.canUpgrade ? null', 'admin available plans resource warning')
excludes(adminBillingSource, 'instance.host.cpuUsed + cpuDelta', 'old post-upgrade admin host counter increment')

includes(apiTypesSource, 'resourceCapacity?:', 'client change plan capacity type')
includes(changePlanModalSource, 'preview.value.resourceWarnings?.[0]', 'user change plan capacity warning display')
includes(adminBillingViewSource, 'selectedUpgradePlanBlocked', 'admin upgrade blocked plan state')
includes(adminBillingViewSource, ':disabled="plan.canUpgrade === false"', 'admin upgrade disabled unavailable plan')

console.log('plan upgrade capacity guard checks passed')
