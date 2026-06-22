import { readFileSync } from 'fs'
import { resolve } from 'path'

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

function indexOfOrThrow(source: string, pattern: string, label: string): number {
  const index = source.indexOf(pattern)
  assert(index >= 0, `Missing ${label}: ${pattern}`)
  return index
}

function section(source: string, startPattern: string, endPattern: string): string {
  const start = indexOfOrThrow(source, startPattern, startPattern)
  const end = indexOfOrThrow(source.slice(start), endPattern, endPattern)
  return source.slice(start, start + end)
}

const repoRoot = resolve(new URL('../..', import.meta.url).pathname)
const hostsSource = readFileSync(resolve(repoRoot, 'server/src/routes/hosts.ts'), 'utf8')

assert(
  hostsSource.includes('async function deleteIncusInstanceForMigration'),
  'host migration must use a strict source Incus delete helper'
)

const migrationSection = section(
  hostsSource,
  'fastify.post<{\n    Params: { id: string }\n    Body: { instanceIds: number[]; targetHostId: number; targetImage: string; targetPlanId?: number }',
  '  })\n\n  // ==================== 批量赠送时长'
)

assert(
  migrationSection.includes('return reply.code(500).send({ error: `无法连接源节点: ${errorMessage}` })'),
  'migration must fail before creating targets when the source Incus client is unavailable'
)

const reserveTarget = indexOfOrThrow(migrationSection, 'await db.reserveResources({', 'target resource reservation')
const createTarget = indexOfOrThrow(migrationSection, 'await createInstance(targetClient, incusConfig)', 'target Incus create')
const startTarget = indexOfOrThrow(migrationSection, 'await startInstance(targetClient, newIncusId)', 'target Incus start')
const createDb = indexOfOrThrow(migrationSection, 'const { createdInstance: newInstance, migratedBillingRecordCount } = await prisma.$transaction', 'new DB instance transaction')
const sourceStatusClaim = indexOfOrThrow(migrationSection, 'data: { status: \'deleted\' }', 'source DB deleted claim')
const deleteSource = indexOfOrThrow(migrationSection, 'await deleteIncusInstanceForMigration(', 'strict source Incus delete')
const sourceDeletedFlag = indexOfOrThrow(migrationSection, 'sourceIncusDeleted = true', 'source deleted flag')
const releaseSource = sourceDeletedFlag + indexOfOrThrow(
  migrationSection.slice(sourceDeletedFlag),
  'hostId: sourceHostId,',
  'source resource release'
)
const notifySuccess = indexOfOrThrow(migrationSection, "eventType: 'instance_migrated'", 'success notification')
const pushSuccess = indexOfOrThrow(migrationSection, 'success: true,', 'success result')

assert(reserveTarget < createTarget, 'migration must reserve target resources before creating the target Incus instance')
assert(createTarget < startTarget, 'migration must create target Incus instance before starting it')
assert(startTarget < createDb, 'migration must start target Incus instance before writing the target DB row')
assert(createDb < deleteSource, 'migration must create the target DB record before deleting the source Incus instance')
assert(sourceStatusClaim < deleteSource, 'migration must claim the source DB row before source Incus deletion')
assert(deleteSource < sourceDeletedFlag, 'migration must only mark source deleted flag after strict source Incus delete')
assert(sourceDeletedFlag < releaseSource, 'migration must release source resources only after source Incus delete succeeds')
assert(sourceDeletedFlag < notifySuccess, 'migration must notify success only after source Incus delete succeeds')
assert(sourceDeletedFlag < pushSuccess, 'migration must return success only after source Incus delete succeeds')

const catchSection = section(
  migrationSection,
  '} catch (err) {\n        const errorMessage = err instanceof Error ? err.message : String(err)',
  '        results.push({ id: instance.id, name: instance.name, success: false, error: errorMessage })'
)

assert(
  catchSection.includes('if (!sourceIncusDeleted)'),
  'migration failure compensation must only run before source Incus deletion has succeeded'
)
assert(
  catchSection.includes('await db.reassignInstanceBillingRecords(newDbInstanceId!, instance.id, tx)'),
  'migration failure compensation must move billing records back to the source instance'
)
assert(
  catchSection.includes('await tx.affBinding.deleteMany({ where: { instanceId: newDbInstanceId! } })'),
  'migration failure compensation must remove copied AFF binding'
)
assert(
  catchSection.includes('await tx.instance.deleteMany({ where: { id: newDbInstanceId! } })'),
  'migration failure compensation must remove the target DB instance'
)
assert(
  catchSection.includes('data: { status: originalInstanceStatus }'),
  'migration failure compensation must restore the original source status'
)
assert(
  catchSection.includes('await deleteIncusInstanceForMigration('),
  'migration failure compensation must delete the target Incus instance'
)
assert(
  catchSection.includes('hostId: targetHostId,'),
  'migration failure compensation must roll back target host resources'
)
assert(
  !migrationSection.includes('删除源实例失败'),
  'migration must not swallow source Incus delete failures and continue'
)
assert(
  !migrationSection.includes('await db.updateHostResources(targetHostId'),
  'migration must not overwrite target resource usage with stale host values'
)

console.log('host migration consistency checks passed')
