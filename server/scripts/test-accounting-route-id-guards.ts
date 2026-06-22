import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const rechargeSource = readFileSync(resolve(__dirname, '../src/routes/recharge.ts'), 'utf8')
const balanceSource = readFileSync(resolve(__dirname, '../src/routes/balance.ts'), 'utf8')
const affSource = readFileSync(resolve(__dirname, '../src/routes/aff.ts'), 'utf8')

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
  rechargeSource.includes('const POSITIVE_ID_PATTERN = /^[1-9]\\d*$/') &&
    rechargeSource.includes('function parsePositiveId(value: unknown): number | null') &&
    rechargeSource.includes('Number.isSafeInteger'),
  'recharge routes must define strict positive safe-integer ID parsing'
)

const createRechargeOrderRoute = sectionBetween(
  rechargeSource,
  "app.post('/api/recharge/orders'",
  '// 获取用户充值记录列表'
)
assert.ok(
  createRechargeOrderRoute.includes('const providerIdNum = parsePositiveId(providerId)') &&
    createRechargeOrderRoute.includes('await db.getPaymentProviderById(providerIdNum)') &&
    createRechargeOrderRoute.includes('providerId: providerIdNum'),
  'recharge order creation must validate providerId before DB lookup and persistence'
)

for (const [label, marker, endMarker] of [
  ['payment provider update', "app.put('/api/admin/payment-providers/:id'", '// 更新支付渠道状态（管理员）'],
  ['payment provider status', "app.patch('/api/admin/payment-providers/:id/status'", '// 删除支付渠道（管理员）'],
  ['payment provider delete', "app.delete('/api/admin/payment-providers/:id'", '// 获取所有充值记录（管理员）']
] as const) {
  const section = sectionBetween(rechargeSource, marker, endMarker)
  assert.ok(
    section.includes('const providerId = parsePositiveId(id)') &&
      section.includes('if (!providerId)'),
    `${label} must reject malformed, decimal, zero, and negative provider IDs`
  )
  assert.ok(!section.includes('parseInt(id, 10)'), `${label} must not use loose parseInt path parsing`)
}

const callbackHandler = sectionBetween(
  rechargeSource,
  'async function handlePaymentCallback(',
  "app.post('/api/recharge/callback/:providerId'"
)
assert.ok(
  callbackHandler.includes('const providerIdNum = parsePositiveId(providerId)') &&
    callbackHandler.includes('if (!providerIdNum)'),
  'payment callbacks must strictly validate provider route IDs before provider lookup'
)
assert.ok(
  !callbackHandler.includes('parseInt(providerId, 10)'),
  'payment callback provider route IDs must not use loose parseInt parsing'
)

assert.ok(
  !rechargeSource.includes('const providerId = parseInt(id, 10)') &&
    !rechargeSource.includes('const providerIdNum = parseInt(providerId, 10)'),
  'recharge routes must not keep loose provider path ID parsing'
)

for (const [name, source, expectedUses] of [
  ['balance', balanceSource, 4],
  ['AFF', affSource, 3]
] as const) {
  assert.ok(
    source.includes('const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\\d*$/') &&
      source.includes('function parsePositiveRouteId(value: string): number | null'),
    `${name} routes must define strict positive route ID parsing`
  )

  const parseUses = source.match(/parsePositiveRouteId\(request\.params\./g)?.length ?? 0
  assert.equal(parseUses, expectedUses, `${name} routes must validate all accounting path IDs`)
  assert.ok(
    !source.includes('Number(request.params.') &&
      !source.includes('parseInt(request.params.'),
    `${name} routes must not use loose path ID parsing`
  )
}

assert.ok(
  sectionFrom(balanceSource, "fastify.post<{\n    Params: { userId: string }")
    .includes('const userId = parsePositiveRouteId(request.params.userId)'),
  'admin balance mutations must validate userId before balance writes'
)

assert.ok(
  sectionFrom(affSource, "fastify.post<{\n    Params: { withdrawalId: string }")
    .includes('const withdrawalId = parsePositiveRouteId(request.params.withdrawalId)'),
  'admin AFF withdrawal review must validate withdrawalId before accounting writes'
)

console.log('accounting route ID guard tests passed')
