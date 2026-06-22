import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const routeSource = readFileSync(resolve(__dirname, '../src/routes/mail.ts'), 'utf8')
const schemaSource = readFileSync(resolve(__dirname, '../prisma/schema.prisma'), 'utf8')

function section(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

assert.ok(
  schemaSource.includes('@@unique([domainId, username])'),
  'mail accounts must keep database uniqueness for per-domain usernames'
)

const createAccountSection = section(
  routeSource,
  '// 创建邮箱账户',
  '// 更新邮箱账户'
)

const upstreamCreateIndex = createAccountSection.indexOf('await smarterMailService.createAccount')
const localCreateIndex = createAccountSection.indexOf('account = await db.createMailAccount')
const compensationDeleteIndex = createAccountSection.indexOf('await smarterMailService.deleteAccount')
const localFailureResponseIndex = createAccountSection.indexOf("'邮箱账户创建失败，已回滚远端账号，请重试'")
const compensationFailureResponseIndex = createAccountSection.indexOf('远端补偿删除失败')
const successLogIndex = createAccountSection.indexOf("'create_mail_account'")

assert.notEqual(upstreamCreateIndex, -1, 'mail account create must call upstream SmarterMail first')
assert.notEqual(localCreateIndex, -1, 'mail account create must persist the local account after upstream create')
assert.notEqual(compensationDeleteIndex, -1, 'mail account create must delete the upstream account if local persistence fails')
assert.notEqual(localFailureResponseIndex, -1, 'mail account create must return an explicit rollback response after successful compensation')
assert.notEqual(compensationFailureResponseIndex, -1, 'mail account create must return an explicit manual-intervention response if compensation fails')
assert.notEqual(successLogIndex, -1, 'mail account create must only log success after local persistence succeeds')

assert.ok(
  upstreamCreateIndex < localCreateIndex,
  'local mail account persistence must only happen after upstream SmarterMail creation succeeds'
)
assert.ok(
  localCreateIndex < compensationDeleteIndex,
  'upstream compensation delete must be in the local persistence failure path'
)
assert.ok(
  localFailureResponseIndex < successLogIndex,
  'mail account create must return before writing a success audit log when local persistence fails'
)

console.log('mail account create compensation tests passed')
