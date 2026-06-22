import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const routeSource = readFileSync(resolve(__dirname, '../src/routes/mail.ts'), 'utf8')
const lockSource = readFileSync(resolve(__dirname, '../src/db/advisory-locks.ts'), 'utf8')
const dbSource = readFileSync(resolve(__dirname, '../src/db/mail.ts'), 'utf8')

function sectionBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

function sectionFrom(source: string, startMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  return source.slice(start)
}

assert.ok(
  lockSource.includes('MAIL_DOMAIN_LOCK_NAMESPACE'),
  'mail domain creation must use a dedicated advisory lock namespace'
)
assert.ok(
  dbSource.includes('createMailDomainWithTx'),
  'mail domain creation must be writable inside the guarded transaction'
)

const addDomainSection = sectionBetween(
  routeSource,
  '// 添加域名',
  '// 刷新域名验证状态'
)
const deleteDomainSection = sectionBetween(
  routeSource,
  '// 删除域名',
  '// ==================== 用户端：邮箱账户管理 ===================='
)
const deleteAccountSection = sectionFrom(routeSource, '// 删除邮箱账户')
const adminCancelSection = sectionBetween(
  routeSource,
  '// 管理员退订（删除订阅）',
  '// ==================== 管理员：域名管理 ===================='
)

const subscriptionLockIndex = addDomainSection.indexOf('tryAdvisoryTransactionLock(tx, MAIL_SUBSCRIPTION_LOCK_NAMESPACE, userId)')
const domainLockIndex = addDomainSection.indexOf('tryAdvisoryTransactionLock(tx, MAIL_DOMAIN_LOCK_NAMESPACE, subscription.sourceId)')
const countIndex = addDomainSection.indexOf('await tx.mailDomain.count')
const existsIndex = addDomainSection.indexOf('await tx.mailDomain.findUnique')
const upstreamCreateIndex = addDomainSection.indexOf('await craneMailService.createDomain')
const localCreateIndex = addDomainSection.indexOf('await db.createMailDomainWithTx')

assert.notEqual(subscriptionLockIndex, -1, 'mail domain add must lock the user subscription')
assert.notEqual(domainLockIndex, -1, 'mail domain add must lock the mail source domain namespace')
assert.notEqual(countIndex, -1, 'mail domain add must re-check domain quota inside the lock')
assert.notEqual(existsIndex, -1, 'mail domain add must re-check source/domain uniqueness inside the lock')
assert.notEqual(upstreamCreateIndex, -1, 'mail domain add must create the upstream domain')
assert.notEqual(localCreateIndex, -1, 'mail domain add must persist the domain inside the same guarded transaction')
assert.ok(subscriptionLockIndex < countIndex, 'quota re-check must happen after acquiring the subscription lock')
assert.ok(domainLockIndex < existsIndex, 'domain uniqueness re-check must happen after acquiring the domain lock')
assert.ok(existsIndex < upstreamCreateIndex, 'upstream domain creation must happen after duplicate re-check')
assert.ok(upstreamCreateIndex < localCreateIndex, 'local domain record must only be created after upstream creation succeeds')

assert.ok(
  adminCancelSection.includes('const source = await db.getMailSourceById(subscription.sourceId)'),
  'admin subscription cancel must use decrypted mail source credentials for upstream deletion'
)
assert.ok(
  adminCancelSection.includes('return reply.code(502).send(apiError(ErrorCode.UPSTREAM_ERROR'),
  'admin subscription cancel must fail instead of deleting local data when upstream domain deletion fails'
)
assert.ok(
  !adminCancelSection.includes('继续处理，不阻塞'),
  'admin subscription cancel must not ignore upstream delete failures'
)
assert.ok(
  deleteDomainSection.includes('return reply.code(502).send(apiError(ErrorCode.UPSTREAM_ERROR'),
  'user domain delete must not delete local data when upstream domain deletion fails'
)
assert.ok(
  !deleteDomainSection.includes('继续删除本地记录'),
  'user domain delete must not ignore upstream delete failures'
)
assert.ok(
  deleteAccountSection.includes('return reply.code(502).send(apiError(ErrorCode.UPSTREAM_ERROR'),
  'mail account delete must not delete local data when upstream account deletion fails'
)
assert.ok(
  !deleteAccountSection.includes('继续删除本地记录'),
  'mail account delete must not ignore upstream delete failures'
)

console.log('mail domain lifecycle guard tests passed')
