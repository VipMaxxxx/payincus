import assert from 'node:assert/strict'
import { apiError, ErrorCode, ErrorMessages } from '../src/lib/errors.js'

const internalError = apiError(
  ErrorCode.INTERNAL_ERROR,
  'Prisma: column x does not exist'
)

assert.equal(internalError.details, undefined)
assert.equal(internalError.code, ErrorCode.INTERNAL_ERROR)
assert.equal(internalError.error, ErrorMessages[ErrorCode.INTERNAL_ERROR])

const tokenError = apiError(
  ErrorCode.INVALID_INPUT,
  'Bearer abc.def+gh/i=='
)
assert.equal(tokenError.details, '[REDACTED_JWT]')

const longError = apiError(ErrorCode.INVALID_INPUT, 'x'.repeat(1024))
assert.ok(longError.details !== undefined)
assert.ok(longError.details.length <= 256)

console.log('error response guards passed')
