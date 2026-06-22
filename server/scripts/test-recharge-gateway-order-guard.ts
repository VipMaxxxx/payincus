import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  isRechargeGatewayOrderNoMatch,
  normalizeRechargeGatewayOrderNo
} from '../src/lib/recharge-order-guard.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

assert.equal(normalizeRechargeGatewayOrderNo(' R123 '), 'R123')
assert.equal(normalizeRechargeGatewayOrderNo('   '), null)
assert.equal(normalizeRechargeGatewayOrderNo(null), null)

assert.equal(isRechargeGatewayOrderNoMatch('R123', 'R123'), true)
assert.equal(isRechargeGatewayOrderNoMatch('R123', ' R123 '), true)
assert.equal(isRechargeGatewayOrderNoMatch('R123', 'R124'), false)
assert.equal(isRechargeGatewayOrderNoMatch('R123', undefined), false)

const routeSource = readFileSync(resolve(__dirname, '../src/routes/recharge.ts'), 'utf8')
assert.ok(
  routeSource.includes("import { isRechargeGatewayOrderNoMatch } from '../lib/recharge-order-guard.js'"),
  'recharge route must import gateway order guard'
)
assert.ok(
  routeSource.includes('!isRechargeGatewayOrderNoMatch(orderNo, queryResult.out_trade_no)'),
  'yipay verify path must reject mismatched gateway order numbers'
)
assert.ok(
  routeSource.includes('!isRechargeGatewayOrderNoMatch(orderNo, queryResult.order_id)'),
  'heleket verify path must reject mismatched gateway order numbers'
)
assert.ok(
  routeSource.includes('拒绝主动完成充值'),
  'mismatched active verification must not complete recharge'
)

console.log('recharge gateway order guard tests passed')
