import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const routeSource = readFileSync(resolve(process.cwd(), 'src/routes/ssh-keys.ts'), 'utf8')

assert.ok(
  routeSource.includes('function parsePositiveRouteId(value: string): number | null') &&
    routeSource.includes('const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\\d*$/') &&
    routeSource.includes('Number.isSafeInteger(parsed)'),
  'SSH key routes must use a strict positive safe-integer route ID parser'
)

assert.ok(
  routeSource.includes('const MAX_SSH_KEY_NAME_LENGTH = 50') &&
    routeSource.includes('const MIN_SSH_PUBLIC_KEY_LENGTH = 20') &&
    routeSource.includes('const MAX_SSH_PUBLIC_KEY_LENGTH = 8192') &&
    routeSource.includes('function isPlainRecord(value: unknown): value is Record<string, unknown>') &&
    routeSource.includes('function normalizeSshKeyCreateInput(input: unknown): { name: string; publicKey: string }'),
  'SSH key create route must define runtime body-shape and length guards'
)

assert.ok(
  routeSource.includes("typeof input.name !== 'string' || typeof input.publicKey !== 'string'") &&
    routeSource.includes("validateName(input.name, 'Key name', 1, MAX_SSH_KEY_NAME_LENGTH)") &&
    routeSource.includes(".replace(/\\r?\\n/g, ' ')") &&
    routeSource.includes("publicKey.length > MAX_SSH_PUBLIC_KEY_LENGTH") &&
    routeSource.includes('/[\\u0000-\\u001F\\u007F]/.test(publicKey)'),
  'SSH key create route must validate name and public-key strings before parsing'
)

assert.equal(
  routeSource.match(/const keyId = parsePositiveRouteId\(id\)/g)?.length ?? 0,
  2,
  'SSH key detail/delete routes must strictly validate key IDs'
)

assert.ok(
  routeSource.includes('normalizedInput = normalizeSshKeyCreateInput(request.body)') &&
    routeSource.includes('const { name, publicKey } = normalizedInput') &&
    routeSource.includes('const parsed = parseSSHPublicKey(publicKey)') &&
    !routeSource.includes('const { name, publicKey } = request.body') &&
    !routeSource.includes('parseSSHPublicKey(publicKey.trim())') &&
    !routeSource.includes('publicKey: publicKey.trim()'),
  'SSH key create route must normalize body before parsing or persistence'
)

for (const forbiddenPattern of [
  'const keyId = Number(id)',
  'isNaN(keyId)'
]) {
  assert.ok(
    !routeSource.includes(forbiddenPattern),
    `SSH key routes must not use loose path ID parsing: ${forbiddenPattern}`
  )
}

console.log('SSH key route ID guard tests passed')
