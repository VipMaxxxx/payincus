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
  source.includes('type MailSubscriptionCancelInput = {') &&
    source.includes("refundType: 'none' | 'full' | 'remaining'") &&
    source.includes('const MAIL_CANCEL_REASON_MAX_LENGTH = 500') &&
    source.includes('function isPlainRecord(value: unknown): value is Record<string, unknown>') &&
    source.includes('function normalizeMailSubscriptionCancelInput(input: unknown): MailSubscriptionCancelInput'),
  'mail subscription cancel route must use a dedicated runtime body normalizer'
)

const normalizerSection = section(
  source,
  'function normalizeMailSubscriptionCancelInput(input: unknown): MailSubscriptionCancelInput',
  'function parseOptionalPositiveQueryInteger'
)

assert.ok(
  normalizerSection.includes('if (!isPlainRecord(input))') &&
    normalizerSection.includes("throw apiError(ErrorCode.VALIDATION_ERROR, '请求参数无效')"),
  'mail subscription cancel normalizer must reject missing, array, or non-object bodies'
)
assert.ok(
  normalizerSection.includes("refundType !== 'none' && refundType !== 'full' && refundType !== 'remaining'") &&
    normalizerSection.includes("throw apiError(ErrorCode.VALIDATION_ERROR, '请选择退款方式')"),
  'mail subscription cancel normalizer must allowlist refundType'
)
assert.ok(
  normalizerSection.includes("input.reason !== undefined && typeof input.reason !== 'string'") &&
    normalizerSection.includes("throw apiError(ErrorCode.VALIDATION_ERROR, '退款原因无效')"),
  'mail subscription cancel normalizer must reject non-string refund reasons'
)
assert.ok(
  normalizerSection.includes('reason.length > MAIL_CANCEL_REASON_MAX_LENGTH') &&
    normalizerSection.includes('退款原因不能超过'),
  'mail subscription cancel normalizer must cap refund reason length'
)
assert.ok(
  normalizerSection.includes("if (refundType !== 'none' && !reason)") &&
    normalizerSection.includes("throw apiError(ErrorCode.VALIDATION_ERROR, '退款时必须填写原因')"),
  'mail subscription cancel normalizer must require a reason for refunding cancellations'
)

const cancelRouteSection = section(
  source,
  '// 管理员退订（删除订阅）',
  '// ==================== 管理员：域名管理 ===================='
)

assert.ok(
  cancelRouteSection.includes('const { refundType, reason } = normalizeMailSubscriptionCancelInput(request.body)'),
  'mail subscription cancel route must normalize the body before business side effects'
)
assert.ok(
  !cancelRouteSection.includes('const { refundType, reason } = request.body') &&
    !cancelRouteSection.includes('reason!.trim()') &&
    !cancelRouteSection.includes('reason.trim()'),
  'mail subscription cancel route must not trust typed request bodies or trim unchecked reasons'
)
assert.ok(
  cancelRouteSection.includes('原因：${reason}'),
  'mail subscription cancel balance log must use the normalized refund reason'
)

console.log('mail subscription cancel guard tests passed')
