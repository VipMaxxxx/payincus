import { readFileSync } from 'fs'
import { resolve } from 'path'
import assert from 'node:assert/strict'
import {
  parseNullablePostgresBigIntInput,
  parseRequiredPostgresBigIntInput,
  POSTGRES_BIGINT_MAX
} from '../src/lib/bigint-input.js'

function includes(source: string, pattern: string, label: string): void {
  assert.ok(source.includes(pattern), `Missing ${label}: ${pattern}`)
}

function excludes(source: string, pattern: string, label: string): void {
  assert.ok(!source.includes(pattern), `Unexpected ${label}: ${pattern}`)
}

const repoRoot = resolve(new URL('../..', import.meta.url).pathname)
const batchConfigSource = readFileSync(resolve(repoRoot, 'server/src/routes/batch-config.ts'), 'utf8')
const packagesSource = readFileSync(resolve(repoRoot, 'server/src/routes/packages.ts'), 'utf8')
const instancesSource = readFileSync(resolve(repoRoot, 'server/src/routes/instances.ts'), 'utf8')

assert.equal(parseNullablePostgresBigIntInput(null), null, 'nullable parser must accept null as unlimited')
assert.equal(parseNullablePostgresBigIntInput(undefined), null, 'nullable parser must keep legacy missing-value behavior')
assert.equal(parseNullablePostgresBigIntInput(''), null, 'nullable parser must accept empty string as unlimited')
assert.equal(parseNullablePostgresBigIntInput('0'), 0n, 'nullable parser must accept explicit zero')
assert.equal(parseNullablePostgresBigIntInput(' 1 '), 1n, 'nullable parser must trim decimal strings')
assert.equal(parseNullablePostgresBigIntInput(1), undefined, 'nullable parser must reject JSON numbers')
assert.equal(parseNullablePostgresBigIntInput('-1'), undefined, 'nullable parser must reject negative values')
assert.equal(parseNullablePostgresBigIntInput('1.5'), undefined, 'nullable parser must reject decimals')
assert.equal(parseNullablePostgresBigIntInput('abc'), undefined, 'nullable parser must reject non-numeric strings')
assert.equal(parseNullablePostgresBigIntInput((POSTGRES_BIGINT_MAX + 1n).toString()), undefined, 'nullable parser must reject PostgreSQL bigint overflow')
assert.equal(parseNullablePostgresBigIntInput(POSTGRES_BIGINT_MAX.toString()), POSTGRES_BIGINT_MAX, 'nullable parser must accept PostgreSQL bigint max')

assert.equal(parseRequiredPostgresBigIntInput(null), undefined, 'required parser must reject null')
assert.equal(parseRequiredPostgresBigIntInput(undefined), undefined, 'required parser must reject missing values')
assert.equal(parseRequiredPostgresBigIntInput(''), undefined, 'required parser must reject empty string')
assert.equal(parseRequiredPostgresBigIntInput('0'), 0n, 'required parser must accept explicit zero')
assert.equal(parseRequiredPostgresBigIntInput('-1'), undefined, 'required parser must reject negative values')
assert.equal(parseRequiredPostgresBigIntInput((POSTGRES_BIGINT_MAX + 1n).toString()), undefined, 'required parser must reject PostgreSQL bigint overflow')

includes(batchConfigSource, "import { parseNullablePostgresBigIntInput } from '../lib/bigint-input.js'", 'batch config bigint parser import')
includes(batchConfigSource, 'parsedMonthlyTrafficLimit = parseNullablePostgresBigIntInput(config.monthlyTrafficLimit)', 'batch config monthly traffic parsing')
includes(batchConfigSource, 'parsedMonthlyTrafficLimit: bigint | null | undefined', 'batch config parsed value threading')
excludes(batchConfigSource, 'BigInt(config.monthlyTrafficLimit)', 'raw batch monthly traffic BigInt conversion')

includes(packagesSource, "import { parseNullablePostgresBigIntInput, parseRequiredPostgresBigIntInput } from '../lib/bigint-input.js'", 'package bigint parser import')
includes(packagesSource, 'const trafficLimit = parseNullablePostgresBigIntInput(monthlyTrafficLimit)', 'package create monthly traffic parsing')
includes(packagesSource, 'parsedMonthlyTrafficLimit = parseNullablePostgresBigIntInput(monthlyTrafficLimit)', 'package update monthly traffic parsing')
includes(packagesSource, 'const parsedTrafficLimit = parseRequiredPostgresBigIntInput(planInput.trafficLimit)', 'package plan traffic parsing')
includes(packagesSource, 'monthlyTrafficLimit?: bigint | null', 'package traffic sync uses parsed monthly traffic limit')
excludes(packagesSource, 'BigInt(monthlyTrafficLimit)', 'raw package monthly traffic BigInt conversion')
excludes(packagesSource, 'BigInt(updates.monthlyTrafficLimit)', 'raw package sync monthly traffic BigInt conversion')
excludes(packagesSource, 'BigInt(trafficLimit)', 'raw package plan traffic BigInt conversion')

includes(instancesSource, "import { parseNullablePostgresBigIntInput } from '../lib/bigint-input.js'", 'instance config bigint parser import')
includes(instancesSource, 'const parsedMonthlyTrafficLimit = parseNullablePostgresBigIntInput(monthlyTrafficLimit)', 'instance monthly traffic parsing')
excludes(instancesSource, 'BigInt(monthlyTrafficLimit)', 'raw instance monthly traffic BigInt conversion')

console.log('resource quota bigint guard checks passed')
