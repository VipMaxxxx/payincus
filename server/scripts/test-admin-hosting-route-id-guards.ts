import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const source = readFileSync(resolve(__dirname, '../src/routes/admin-hosting.ts'), 'utf8')
const hostingSource = readFileSync(resolve(__dirname, '../src/routes/hosting.ts'), 'utf8')
const viewSource = readFileSync(resolve(__dirname, '../../client/src/views/admin/HostingView.vue'), 'utf8')

assert.ok(
  source.includes('const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\\d*$/') &&
    source.includes('function parsePositiveRouteId(value: string): number | null') &&
    source.includes('Number.isSafeInteger(parsed)'),
  'admin hosting routes must define strict positive safe-integer route ID parsing'
)

assert.equal(
  source.match(/const zoneId = parsePositiveRouteId\(request\.params\.id\)/g)?.length ?? 0,
  1,
  'admin hosting zone delete route must strictly validate zone route ID'
)

assert.ok(
  hostingSource.includes("}>('/admin/withdrawals/:id/approve'") &&
    hostingSource.includes("}>('/admin/withdrawals/:id/reject'") &&
    (hostingSource.match(/const withdrawalId = parsePositiveRouteId\(request\.params\.id\)/g)?.length ?? 0) === 2 &&
    (hostingSource.match(/onRequest: \[fastify\.authenticate, fastify\.requireAdmin\]/g)?.length ?? 0) >= 2,
  'hosting cash withdrawal approval routes must validate route IDs and require admin authentication'
)

assert.ok(
  hostingSource.includes("target: 'usdt'") &&
    hostingSource.includes("status: 'pending'") &&
    hostingSource.includes("status: 'completed'") &&
    hostingSource.includes('if (approved.count !== 1)') &&
    hostingSource.includes("code: 'WITHDRAWAL_ALREADY_PROCESSED'"),
  'cash withdrawal approval must use an idempotent pending-to-completed conditional transition'
)

for (const forbiddenPattern of [
  'const zoneId = Number(request.params.id)',
  'Number.isInteger(zoneId)',
  'isNaN(zoneId)'
] as const) {
  assert.ok(
    !source.includes(forbiddenPattern),
    `admin hosting routes must not use loose path ID parsing: ${forbiddenPattern}`
  )
}

assert.ok(
  viewSource.includes('table class="w-full table-fixed"') &&
    viewSource.includes('table class="w-full table-fixed"') &&
    (viewSource.match(/class="space-y-3 p-4 lg:hidden"/g)?.length ?? 0) >= 2 &&
    (viewSource.match(/class="hidden overflow-hidden lg:block"/g)?.length ?? 0) >= 2 &&
    !viewSource.includes('v-else class="overflow-x-auto"') &&
    !viewSource.includes('table class="w-full min-w-[1040px]"') &&
    !viewSource.includes('table class="w-full min-w-[820px]"'),
  'admin hosting view must keep mobile cards and fixed desktop tables for owners and zones'
)

assert.ok(
  viewSource.includes('@click="toggleOwnerSort(column.key)"') &&
    viewSource.includes('@change="loadOwners"') &&
    viewSource.includes('@click="sortOrder = sortOrder === \'asc\' ? \'desc\' : \'asc\'; loadOwners()"') &&
    viewSource.includes('@click="deleteZone(zone)"') &&
    viewSource.includes('deletingZoneId === zone.id'),
  'admin hosting responsive layout must preserve owner sorting and zone delete actions'
)

console.log('admin hosting route ID guard tests passed')
