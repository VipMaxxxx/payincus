import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const source = readFileSync(resolve(__dirname, '../src/workers/instanceTaskWorker.ts'), 'utf8')
const portMappingsSource = readFileSync(resolve(__dirname, '../src/db/port-mappings.ts'), 'utf8')

function indexOfOrThrow(sourceText: string, pattern: string, label: string): number {
  const index = sourceText.indexOf(pattern)
  assert.ok(index >= 0, `Missing ${label}: ${pattern}`)
  return index
}

function section(sourceText: string, startPattern: string, endPattern: string): string {
  const start = indexOfOrThrow(sourceText, startPattern, startPattern)
  const end = indexOfOrThrow(sourceText.slice(start), endPattern, endPattern)
  return sourceText.slice(start, start + end)
}

const cleanupSection = section(
  source,
  'async function cleanupRecreatedInstanceRecords(',
  '/**\n * 服务启动时清理僵尸任务'
)

assert.ok(
  cleanupSection.includes('const deletedPortMappings = await tx.portMapping.deleteMany({ where: { instanceId } })') &&
    cleanupSection.includes('natPortsUsedCount: { decrement: deletedPortMappings.count }') &&
    cleanupSection.includes('data: { natPortsUsedCount: 0 }'),
  'recreate cleanup must delete port mappings and release host NAT port counters defensively'
)

const recreateSection = section(
  source,
  'async function executeRecreateTask(',
  '/**\n * 执行改节点任务'
)

assert.ok(
  recreateSection.includes('let oldInstanceDeleted = false') &&
    recreateSection.includes('let newInstanceCreated = false') &&
    recreateSection.includes('let databaseSwitched = false'),
  'recreate must track old/new/database switch state for failure compensation'
)

const deleteOld = indexOfOrThrow(recreateSection, 'await deleteInstance(client, oldIncusId)', 'old Incus delete')
const markOldDeleted = indexOfOrThrow(recreateSection, 'oldInstanceDeleted = true', 'old deleted marker')
const createNew = indexOfOrThrow(recreateSection, 'await createInstance(client, incusConfig)', 'new Incus create')
const markNewCreated = indexOfOrThrow(recreateSection, 'newInstanceCreated = true', 'new created marker')
const cleanupRecords = indexOfOrThrow(recreateSection, 'await cleanupRecreatedInstanceRecords(task.instanceId, instance.host_id)', 'recreate DB cleanup')
const updateDb = indexOfOrThrow(recreateSection, 'await prisma.instance.update({', 'instance DB switch')
const markDbSwitched = indexOfOrThrow(recreateSection, 'databaseSwitched = true', 'database switched marker')

assert.ok(deleteOld < markOldDeleted, 'recreate must mark old deleted only after strict old Incus delete succeeds')
assert.ok(markOldDeleted < createNew, 'recreate must create replacement only after old Incus is gone')
assert.ok(createNew < markNewCreated, 'recreate must mark replacement created only after Incus create succeeds')
assert.ok(markNewCreated < cleanupRecords, 'recreate must not delete old DB associations before replacement exists')
assert.ok(cleanupRecords < updateDb, 'recreate must clean stale associations before switching DB to replacement')
assert.ok(updateDb < markDbSwitched, 'recreate must mark DB switched only after instance update succeeds')

const catchIndex = indexOfOrThrow(recreateSection, '} catch (err) {', 'recreate catch')
const catchSection = recreateSection.slice(catchIndex)

assert.ok(
  catchSection.includes('if (!databaseSwitched && newInstanceCreated)') &&
    catchSection.includes('await deleteInstance(client, newIncusId)'),
  'recreate failure must clean up replacement Incus instance before DB switch'
)

assert.ok(
  catchSection.includes('if (!databaseSwitched && oldInstanceDeleted)') &&
    catchSection.includes("status: 'error'") &&
    catchSection.includes('await prisma.ipAddress.deleteMany({ where: { instanceId: task.instanceId } })') &&
    catchSection.includes('await prisma.ipv6Subnet.deleteMany({ where: { instanceId: task.instanceId } })'),
  'recreate failure after old deletion must mark DB instance error and clear stale address records'
)

const cloneSection = section(
  source,
  'async function executeCloneTask(',
  '/**\n * 启动 Worker'
)
assert.ok(
  portMappingsSource.includes('excludedPorts: number[] = []') &&
    portMappingsSource.includes('for (const port of excludedPorts)') &&
    portMappingsSource.includes('usedPorts.add(port)'),
  'allocatePort must support excluding caller-reserved ports from the available pool'
)
assert.ok(
  cloneSection.includes("const selectedClonePortsByProtocol: Record<'tcp' | 'udp', Set<number>>") &&
    cloneSection.includes('Array.from(selectedClonePortsByProtocol[protocol])') &&
    cloneSection.includes('selectedClonePortsByProtocol[protocol].add(newPublicPort)'),
  'clone port allocation must exclude ports already selected earlier in the same clone task'
)
const cloneCatchIndex = indexOfOrThrow(cloneSection, '} catch (error) {', 'clone catch')
const cloneCatchSection = cloneSection.slice(cloneCatchIndex)

assert.ok(
  cloneCatchSection.includes('let incusCloneReleased = false') &&
    cloneCatchSection.includes('incusCloneReleased = true') &&
    cloneCatchSection.includes('Instance not found'),
  'clone failure cleanup must explicitly track whether the Incus clone was deleted or already absent'
)

assert.ok(
  cloneCatchSection.includes('if (incusCloneReleased)') &&
    cloneCatchSection.includes('await prisma.instance.delete({') &&
    cloneCatchSection.includes("data: { status: 'error' }"),
  'clone failure cleanup must only delete DB rows after Incus cleanup, otherwise mark the clone record error'
)

assert.ok(
  cloneCatchSection.includes('if (incusCloneReleased && (!cloneDbRecordExists || cloneDbRecordRemoved))') &&
    cloneCatchSection.includes('await db.rollbackResources({') &&
    cloneCatchSection.includes('暂不释放宿主机资源占用'),
  'clone failure cleanup must release host resources only after the Incus clone and DB record are fully cleaned'
)

const cloneDbDeleteIndex = indexOfOrThrow(cloneCatchSection, 'await prisma.instance.delete({', 'clone DB delete')
const cloneRollbackIndex = indexOfOrThrow(cloneCatchSection, 'await db.rollbackResources({', 'clone resource rollback')
assert.ok(
  cloneDbDeleteIndex < cloneRollbackIndex,
  'clone failure cleanup must delete the failed DB clone before rolling back reserved host resources'
)

console.log('instance recreate consistency checks passed')
