import { readFileSync } from 'fs'
import { resolve } from 'path'
import assert from 'node:assert/strict'
import { normalizePlanTrafficLimitSpeed } from '../src/services/traffic-bandwidth.js'

function includes(source: string, pattern: string, label: string): void {
  assert.ok(source.includes(pattern), `Missing ${label}: ${pattern}`)
}

function excludes(source: string, pattern: string, label: string): void {
  assert.ok(!source.includes(pattern), `Unexpected ${label}: ${pattern}`)
}

const repoRoot = resolve(new URL('../..', import.meta.url).pathname)
const instancesSource = readFileSync(resolve(repoRoot, 'server/src/routes/instances.ts'), 'utf8')
const adminBillingSource = readFileSync(resolve(repoRoot, 'server/src/routes/admin-billing.ts'), 'utf8')
const hostsSource = readFileSync(resolve(repoRoot, 'server/src/routes/hosts.ts'), 'utf8')
const packagesSource = readFileSync(resolve(repoRoot, 'server/src/routes/packages.ts'), 'utf8')
const myPackagesViewSource = readFileSync(resolve(repoRoot, 'client/src/views/resources/MyPackagesView.vue'), 'utf8')

assert.equal(normalizePlanTrafficLimitSpeed(null), null, 'null speed must mean no plan bandwidth limit')
assert.equal(normalizePlanTrafficLimitSpeed(undefined), null, 'missing speed must mean no plan bandwidth limit')
assert.equal(normalizePlanTrafficLimitSpeed(''), null, 'empty speed must mean no plan bandwidth limit')
assert.equal(normalizePlanTrafficLimitSpeed('0'), null, 'zero speed must mean no plan bandwidth limit')
assert.equal(normalizePlanTrafficLimitSpeed('5Mbit'), '5Mbit', 'Mbit speed must remain usable by Incus')
assert.equal(normalizePlanTrafficLimitSpeed('1Gbit'), '1000Mbit', 'Gbit speed must be normalized to Mbit')
assert.equal(normalizePlanTrafficLimitSpeed('10485760'), '10Mbit', 'numeric byte speed must be converted to Mbit')
assert.equal(normalizePlanTrafficLimitSpeed('1024'), null, 'sub-Mbit numeric byte speed must disable the limit')
assert.equal(normalizePlanTrafficLimitSpeed('-1'), undefined, 'negative speed must be rejected')
assert.equal(normalizePlanTrafficLimitSpeed('abc'), undefined, 'malformed speed must be rejected')
assert.equal(normalizePlanTrafficLimitSpeed(10), undefined, 'JSON number speed must be rejected')

for (const [label, source] of [
  ['user instance create route', instancesSource],
  ['admin instance create route', adminBillingSource],
  ['host delegated instance create route', hostsSource]
] as const) {
  includes(source, "import { normalizePlanTrafficLimitSpeed } from '../services/traffic-bandwidth.js'", `${label} bandwidth import`)
  includes(source, 'normalizePlanTrafficLimitSpeed(selectedPlan.trafficLimitSpeed)', `${label} plan speed normalization`)
}

excludes(instancesSource, 'BigInt(selectedPlan.trafficLimitSpeed)', 'raw user instance plan speed BigInt conversion')
excludes(adminBillingSource, 'BigInt(selectedPlan.trafficLimitSpeed)', 'raw admin instance plan speed BigInt conversion')

includes(packagesSource, 'const parsedTrafficLimitSpeed = normalizePlanTrafficLimitSpeed(planInput.trafficLimitSpeed)', 'package plan speed validation')
includes(packagesSource, "apiError(ErrorCode.INVALID_PARAMS, 'Invalid plan traffic limit speed')", 'package plan invalid speed response')
includes(myPackagesViewSource, "bytes.match(/^(\\d+(?:\\.\\d+)?)\\s*Mbit$/i)", 'package plan edit Mbit parsing')
includes(myPackagesViewSource, "bytes.match(/^(\\d+(?:\\.\\d+)?)\\s*Gbit$/i)", 'package plan edit Gbit parsing')

console.log('plan bandwidth limit guard checks passed')
