import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const source = readFileSync(resolve(__dirname, '../src/routes/mail.ts'), 'utf8')

assert.ok(
  source.includes('function normalizeMailAccountInput'),
  'mail account create/update routes must share normalized backend validation'
)
assert.ok(
  source.includes("const diskLimitMb = requireSafeInteger(input.diskLimitMb, '邮箱容量')"),
  'mail account disk quota must require a runtime JSON integer'
)
assert.ok(
  !source.includes('const diskLimitMb = Number(input.diskLimitMb)'),
  'mail account disk quota must not use loose numeric coercion'
)
assert.ok(
  source.includes('diskLimitMb <= 0 || diskLimitMb > maxDiskLimitMb'),
  'mail account disk limits must be positive and capped by subscription quota'
)
assert.ok(
  source.includes('password.length < 8 || password.length > 128'),
  'mail account password length must be bounded'
)
assert.ok(
  source.includes('username.length > 64'),
  'mail account username length must be bounded before upstream calls'
)

const createSectionStart = source.indexOf('// 创建邮箱账户')
const updateSectionStart = source.indexOf('// 更新邮箱账户')
const resetSectionStart = source.indexOf('// 重置邮箱账户密码')
assert.notEqual(createSectionStart, -1, 'mail account create section not found')
assert.notEqual(updateSectionStart, -1, 'mail account update section not found')
assert.notEqual(resetSectionStart, -1, 'mail account reset section not found')

const createSection = source.slice(createSectionStart, updateSectionStart)
const updateSection = source.slice(updateSectionStart, resetSectionStart)
const resetSection = source.slice(resetSectionStart)

assert.ok(
  createSection.includes('const maxDiskLimitMb = domain.subscription.diskLimitGb * 1024'),
  'mail account create route must derive disk cap from subscription quota'
)
assert.ok(
  createSection.includes('const accountDiskLimitMb = accountInput.diskLimitMb ?? Math.min(2048, maxDiskLimitMb)'),
  'mail account create route must keep default disk quota within subscription quota'
)
assert.ok(
  createSection.includes('isAdmin: false'),
  'mail account create route must not trust user-supplied isAdmin'
)
assert.ok(
  !createSection.includes('isAdmin: isAdmin || false'),
  'mail account create route must not persist user-supplied isAdmin'
)
assert.ok(
  updateSection.includes('maxDiskLimitMb: domain.subscription.diskLimitGb * 1024'),
  'mail account update route must cap disk updates by subscription quota'
)
assert.ok(
  updateSection.includes('diskLimitMb: accountInput.diskLimitMb'),
  'mail account update route must persist normalized disk limits'
)
assert.ok(
  resetSection.includes('const passwordInput = normalizeMailAccountInput({ password }') &&
    resetSection.includes('passwordInput.password!'),
  'mail account password reset route must use the shared bounded password validation'
)

console.log('mail account quota guard tests passed')
