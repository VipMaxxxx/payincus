import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const source = readFileSync(resolve(__dirname, '../src/routes/mail.ts'), 'utf8')

function section(sourceText: string, startMarker: string, endMarker: string): string {
  const start = sourceText.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = sourceText.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return sourceText.slice(start, end)
}

assert.ok(
  source.includes('type MailSourceInput = {') &&
    source.includes('const MAIL_SOURCE_CODE_RE = /^[a-z0-9_-]{2,32}$/') &&
    source.includes('const MAIL_SOURCE_SECRET_MAX_LENGTH = 4096') &&
    source.includes('function optionalString(value: unknown, field: string, maxLength: number): string | undefined') &&
    source.includes('function normalizeMailSourceInput(input: unknown, requireAll: boolean): MailSourceInput'),
  'mail source routes must use a dedicated runtime input normalizer'
)

const normalizerSection = section(
  source,
  'function normalizeMailSourceInput(input: unknown, requireAll: boolean): MailSourceInput',
  'function normalizeMailAccountInput'
)

assert.ok(
  normalizerSection.includes('if (!isPlainRecord(input))') &&
    normalizerSection.includes("throw apiError(ErrorCode.VALIDATION_ERROR, '请求参数无效')"),
  'mail source normalizer must reject missing, array, or non-object bodies'
)
assert.ok(
  normalizerSection.includes("const code = optionalString(input.code, '地区代码', 32)") &&
    normalizerSection.includes('const normalizedCode = code.toLowerCase()') &&
    normalizerSection.includes('!MAIL_SOURCE_CODE_RE.test(normalizedCode)'),
  'mail source code must be string-normalized and format-checked before lowercasing'
)
assert.ok(
  normalizerSection.includes("const apiUrl = optionalString(input.apiUrl, 'CraneMail API URL', 2048)") &&
    normalizerSection.includes("const smarterMailUrl = optionalString(input.smarterMailUrl, 'SmarterMail URL', 2048)"),
  'mail source URLs must be runtime strings before outbound URL validation'
)
assert.ok(
  normalizerSection.includes("typeof input.apiKey !== 'string'") &&
    normalizerSection.includes('apiKey.length > MAIL_SOURCE_SECRET_MAX_LENGTH') &&
    normalizerSection.includes("if (requireAll && !apiKey)"),
  'mail source API keys must be runtime strings, required on create, and length-bounded'
)
assert.ok(
  normalizerSection.includes("typeof input.enabled !== 'boolean'") &&
    normalizerSection.includes("const sortOrder = requireSafeInteger(input.sortOrder, '排序值')"),
  'mail source enabled and sortOrder fields must be type-checked before persistence'
)

const createSourceSection = section(
  source,
  '// 创建邮箱源',
  '// 更新邮箱源'
)
const updateSourceSection = section(
  source,
  '// 更新邮箱源',
  '// 删除邮箱源'
)

assert.ok(
  createSourceSection.includes('const sourceInput = normalizeMailSourceInput(request.body, true)') &&
    createSourceSection.includes('db.getMailSourceByCode(sourceInput.code!)') &&
    createSourceSection.includes('apiUrl: sourceInput.apiUrl') &&
    createSourceSection.includes('code: sourceInput.code!') &&
    createSourceSection.includes('apiKey: sourceInput.apiKey!') &&
    createSourceSection.includes('enabled: sourceInput.enabled ?? true') &&
    createSourceSection.includes('sortOrder: sourceInput.sortOrder ?? 0'),
  'mail source create must use normalized values for uniqueness checks, URL validation, and persistence'
)
assert.ok(
  updateSourceSection.includes('const sourceInput = normalizeMailSourceInput(request.body, false)') &&
    updateSourceSection.includes('if (sourceInput.code && sourceInput.code !== existing.code)') &&
    updateSourceSection.includes('db.getMailSourceByCode(sourceInput.code)') &&
    updateSourceSection.includes('apiUrl: sourceInput.apiUrl') &&
    updateSourceSection.includes('code: sourceInput.code') &&
    updateSourceSection.includes('apiKey: db.mergeMailSourceApiKeyForUpdate(sourceInput.apiKey)') &&
    updateSourceSection.includes('enabled: sourceInput.enabled') &&
    updateSourceSection.includes('sortOrder: sourceInput.sortOrder'),
  'mail source update must use normalized values while preserving blank or masked API keys'
)

for (const forbiddenPattern of [
  'const { name, code, apiUrl, apiKey, smarterMailUrl, enabled, sortOrder } = request.body',
  'code?.toLowerCase()',
  'code.toLowerCase(),',
  'db.getMailSourceByCode(code)'
] as const) {
  assert.ok(
    !createSourceSection.includes(forbiddenPattern) && !updateSourceSection.includes(forbiddenPattern),
    `mail source routes must not trust typed body fields directly: ${forbiddenPattern}`
  )
}

console.log('mail source input guard tests passed')
