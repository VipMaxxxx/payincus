import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '../..')

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

function section(source: string, startPattern: string, endPattern: string): string {
  const start = source.indexOf(startPattern)
  assert.notEqual(start, -1, `Missing section start: ${startPattern}`)
  const end = source.indexOf(endPattern, start)
  assert.notEqual(end, -1, `Missing section end: ${endPattern}`)
  return source.slice(start, end)
}

const quotaSource = readRepoFile('server/src/db/quota-operations.ts')

const reserveSection = section(
  quotaSource,
  'export async function reserveResources(',
  '/**\n * 资源回滚'
)
assert.ok(
  reserveSection.includes('const reserveWhere: Prisma.HostWhereInput = { id: hostId }') &&
    reserveSection.includes('reserveWhere.cpuUsed = { lte: cpuLimit - cpu }') &&
    reserveSection.includes('reserveWhere.memoryUsed = { lte: memoryLimit - memory }') &&
    reserveSection.includes('reserveWhere.natPortsUsedCount = { lte: natPortsTotal - portCount }') &&
    reserveSection.includes('await tx.host.updateMany({') &&
    reserveSection.includes('cpuUsed: { increment: cpu }') &&
    reserveSection.includes('memoryUsed: { increment: memory }') &&
    reserveSection.includes('diskUsed: { increment: disk }') &&
    reserveSection.includes('natPortsUsedCount: { increment: portCount }') &&
    reserveSection.includes('if (result.count === 0)'),
  'host resource reservation must use bounded conditional atomic increments'
)
assert.ok(
  !reserveSection.includes('cpuUsed: host.cpuUsed + cpu') &&
    !reserveSection.includes('memoryUsed: host.memoryUsed + memory') &&
    !reserveSection.includes('diskUsed: host.diskUsed + disk') &&
    !reserveSection.includes('natPortsUsedCount: host.natPortsUsedCount + portCount'),
  'host resource reservation must not write back stale read-modify-write values'
)

const rollbackSection = section(
  quotaSource,
  'export async function rollbackResources(',
  '/**\n * 计算用户配额使用量'
)
assert.ok(
  rollbackSection.includes('UPDATE hosts') &&
    rollbackSection.includes('cpu_used = GREATEST(cpu_used - ${cpu}, 0)') &&
    rollbackSection.includes('memory_used = GREATEST(memory_used - ${memory}, 0)') &&
    rollbackSection.includes('disk_used = GREATEST(disk_used - ${disk}, 0)') &&
    rollbackSection.includes('nat_ports_used_count = GREATEST(nat_ports_used_count - ${portCount}, 0)') &&
    rollbackSection.includes('WHERE id = ${hostId}'),
  'host resource rollback must use atomic SQL GREATEST decrements'
)
assert.ok(
  !rollbackSection.includes('Math.max(0, host.cpuUsed - cpu)') &&
    !rollbackSection.includes('Math.max(0, host.memoryUsed - memory)') &&
    !rollbackSection.includes('Math.max(0, host.diskUsed - disk)') &&
    !rollbackSection.includes('Math.max(0, host.natPortsUsedCount - portCount)') &&
    !rollbackSection.includes('where: { id: hostId },\n        data:'),
  'host resource rollback must not use stale read-modify-write updates'
)

console.log('host resource atomic guard checks passed')
