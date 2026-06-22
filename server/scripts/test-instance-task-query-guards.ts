import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const source = readFileSync(resolve(__dirname, '../src/db/instance-tasks.ts'), 'utf8')

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

assert.ok(
  source.includes('const INSTANCE_TASK_STATUSES = new Set<InstanceTaskStatus>') &&
    source.includes("'PENDING'") &&
    source.includes("'PROCESSING'") &&
    source.includes("'COMPLETED'") &&
    source.includes("'FAILED'"),
  'instance task query helpers must define an explicit status allowlist'
)

assert.ok(
  source.includes('function clampInstanceTaskPagination(') &&
    source.includes('page: Number.isInteger(page) && page !== undefined && page > 0 ? page : 1') &&
    source.includes('Math.min(Math.max(pageSize, 1), 100)'),
  'instance task query helpers must clamp invalid or excessive pagination'
)

assert.ok(
  source.includes('function normalizeInstanceTaskStatuses(status?: InstanceTaskStatus[]): InstanceTaskStatus[] | undefined') &&
    source.includes('INSTANCE_TASK_STATUSES.has(value)'),
  'instance task query helpers must ignore unknown status filters'
)

const listSection = sectionBetween(
  'export async function getUserInstanceTasks(',
  '/**\n * 更新任务状态'
)

assert.ok(
  listSection.includes('const { page, pageSize } = clampInstanceTaskPagination(options.page, options.pageSize)') &&
    listSection.includes('const status = normalizeInstanceTaskStatuses(options.status)'),
  'getUserInstanceTasks must normalize pagination and status filters before building Prisma options'
)

assert.ok(
  listSection.includes('skip: (page - 1) * pageSize') &&
    listSection.includes('take: pageSize'),
  'getUserInstanceTasks must query with sanitized pagination values'
)

assert.ok(
  !listSection.includes('const { page = 1, pageSize = 20, status } = options'),
  'getUserInstanceTasks must not trust raw caller pagination and status options'
)

console.log('instance task query guard tests passed')
