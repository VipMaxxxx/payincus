import '../src/config/env.js'
import assert from 'node:assert/strict'
import {
  closePrismaDatabase,
  createPaymentProvider,
  createRechargeOrder,
  createUser,
  deletePaymentProvider,
  deleteUser,
  getRechargeRecordByOrderNo,
  getUserBalance,
  prisma
} from '../src/db/index.js'

type JsonObject = Record<string, unknown>

interface FetchResult {
  response: Response
  data: JsonObject
  text: string
}

const apiBaseUrl = trimSlash(
  process.env.SMOKE_API_BASE_URL ||
    process.env.SMOKE_FRONTEND_URL ||
    process.env.FRONTEND_URL ||
    process.env.BACKEND_URL ||
    'http://127.0.0.1:3001'
)

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

async function postJson(path: string, body: unknown): Promise<FetchResult> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'incudal-recharge-callback-smoke/1.0'
    },
    body: JSON.stringify(body)
  })
  const text = await response.text()
  let data: JsonObject = {}
  try {
    data = text ? JSON.parse(text) as JsonObject : {}
  } catch {
    data = {}
  }
  return { response, data, text }
}

async function main(): Promise<void> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  let userId: number | null = null
  let providerId: number | null = null
  let orderNo: string | null = null

  async function cleanup(): Promise<void> {
    try {
      if (providerId && orderNo) {
        await prisma.paymentCallback.deleteMany({ where: { providerId, orderNo } })
      }
      if (orderNo) {
        await prisma.rechargeRecord.deleteMany({ where: { orderNo } })
      }
      if (providerId) {
        await deletePaymentProvider(providerId)
      }
      if (userId) {
        await deleteUser(userId)
      }
    } catch (error) {
      console.warn('[smoke-recharge-callback] cleanup failed', {
        userId,
        providerId,
        orderNo,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  try {
    const health = await fetch(`${apiBaseUrl}/api/health`, {
      headers: { Accept: 'application/json', 'User-Agent': 'incudal-recharge-callback-smoke/1.0' }
    })
    assert.equal(health.status, 200, `backend health expected 200, got ${health.status}`)

    const malformed = await postJson('/api/recharge/callback/1', [])
    assert.equal(malformed.response.status, 400, `malformed callback expected 400, got ${malformed.response.status}: ${malformed.text}`)

    userId = await createUser(
      `smoke-pay-${suffix}`,
      `smoke-pay-${suffix}@incudal-smoke.local`,
      'not-used-by-callback-smoke',
      'user'
    )

    const provider = await createPaymentProvider({
      name: `Smoke Yipay ${suffix}`,
      type: 'yipay',
      status: 'active',
      config: {
        version: 'v1',
        apiurl: 'https://pay.example.com',
        pid: 'smoke-pid',
        key: 'correct-smoke-secret'
      },
      methods: ['alipay'],
      minAmount: 1
    })
    providerId = provider.id

    const order = await createRechargeOrder({
      userId,
      providerId,
      amount: 12.34,
      paymentMethod: 'alipay',
      expiredAt: new Date(Date.now() + 30 * 60 * 1000)
    })
    orderNo = order.orderNo

    const balanceBefore = await getUserBalance(userId)
    const forgedCallback = await postJson(`/api/recharge/callback/${providerId}`, {
      pid: 'smoke-pid',
      trade_no: `SMOKE-${suffix}`,
      out_trade_no: orderNo,
      type: 'alipay',
      name: '账户充值',
      money: '12.34',
      trade_status: 'TRADE_SUCCESS',
      sign: 'definitely-wrong-signature',
      sign_type: 'MD5'
    })

    assert.equal(forgedCallback.response.status, 400, `forged callback expected 400, got ${forgedCallback.response.status}: ${forgedCallback.text}`)
    assert.match(
      String(forgedCallback.data.error || forgedCallback.text),
      /签名|signature/i,
      'forged callback response should identify signature failure'
    )

    const persistedOrder = await getRechargeRecordByOrderNo(orderNo)
    assert.equal(persistedOrder?.status, 'pending', 'forged callback must not change recharge status')
    assert.equal(await getUserBalance(userId), balanceBefore, 'forged callback must not credit user balance')

    const callbackRows = await prisma.paymentCallback.count({ where: { providerId, orderNo } })
    assert.equal(callbackRows, 0, 'forged callback must not be marked processed')

    console.log('[smoke-recharge-callback] passed', {
      apiBaseUrl,
      providerId,
      orderNo,
      forgedStatus: forgedCallback.response.status,
      orderStatus: persistedOrder?.status
    })
  } finally {
    await cleanup()
    await closePrismaDatabase()
  }
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
