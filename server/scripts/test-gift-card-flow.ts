import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { prisma, closePrismaDatabase } from '../src/db/prisma.js'
import * as giftCards from '../src/db/gift-cards.js'

if (process.env.NODE_ENV === 'production' && process.env.ALLOW_GIFT_CARD_FLOW_TEST !== '1') {
  throw new Error('Refusing to run gift card flow test in production without ALLOW_GIFT_CARD_FLOW_TEST=1')
}

const runId = `giftcard_flow_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
const ownerUsername = `${runId}_owner`
const recipientUsername = `${runId}_recipient`

async function giftCardTableExists(): Promise<boolean> {
  const result = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = 'gift_cards'
    ) AS "exists"
  `
  return result[0]?.exists === true
}

async function expectError(action: () => Promise<unknown>, message: string): Promise<void> {
  await assert.rejects(action, (error) => {
    return error instanceof Error && error.message === message
  })
}

async function cleanup(): Promise<void> {
  if (!(await giftCardTableExists())) return

  const users = await prisma.user.findMany({
    where: { username: { in: [ownerUsername, recipientUsername] } },
    select: { id: true }
  })
  const userIds = users.map(user => user.id)

  await prisma.giftCard.deleteMany({
    where: {
      OR: [
        { remark: { startsWith: runId } },
        { batchId: { startsWith: runId } },
        { createdById: { in: userIds } },
        { ownerId: { in: userIds } },
        { usedById: { in: userIds } }
      ]
    }
  })

  if (userIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  }
}

async function main(): Promise<void> {
  assert.equal(
    await giftCardTableExists(),
    true,
    'gift_cards table is missing; apply Prisma migrations before running the gift card flow test'
  )

  await cleanup()

  const [owner, recipient] = await Promise.all([
    prisma.user.create({
      data: {
        username: ownerUsername,
        email: `${ownerUsername}@example.test`,
        passwordHash: 'gift-card-flow-test',
        balance: 100
      },
      select: { id: true }
    }),
    prisma.user.create({
      data: {
        username: recipientUsername,
        email: `${recipientUsername}@example.test`,
        passwordHash: 'gift-card-flow-test',
        balance: 0
      },
      select: { id: true }
    })
  ])

  const adminCard = await giftCards.createGiftCard({
    faceValue: 12.34,
    balanceValue: 12.34,
    remark: `${runId}:admin-single`
  })
  assert.match(adminCard.code, /^gc-[A-Za-z0-9_-]{24}$/)
  assert.equal(adminCard.status, 'active')

  const disabled = await giftCards.disableGiftCard(adminCard.id)
  assert.equal(disabled.count, 1)
  await expectError(() => giftCards.redeemGiftCard(adminCard.code, recipient.id), 'GIFT_CARD_DISABLED')

  const enabled = await giftCards.enableGiftCard(adminCard.id)
  assert.equal(enabled.count, 1)

  const redeemed = await giftCards.redeemGiftCard(adminCard.code, recipient.id)
  assert.equal(redeemed.balanceValue, 12.34)
  assert.equal(redeemed.balanceBefore, 0)
  assert.equal(redeemed.balanceAfter, 12.34)
  await expectError(() => giftCards.redeemGiftCard(adminCard.code, recipient.id), 'GIFT_CARD_USED')

  const redeemedCard = await giftCards.findGiftCardByCode(adminCard.code)
  assert.equal(redeemedCard?.status, 'used')
  assert.equal(redeemedCard?.usedById, recipient.id)
  assert.ok(redeemedCard?.usedAt)

  const recipientCards = await giftCards.listGiftCardsByUser(recipient.id, { page: 1, pageSize: 20 })
  assert.ok(
    recipientCards.records.some(card => card.id === adminCard.id && card.status === 'used'),
    'redeemed admin-created cards must be visible in the recipient gift card list'
  )

  const userGenerated = await giftCards.generateGiftCardFromBalance({
    userId: owner.id,
    faceValue: 20,
    remark: `${runId}:user-generated`
  })
  assert.equal(userGenerated.balanceBefore, 100)
  assert.equal(userGenerated.balanceAfter, 80)
  assert.equal(userGenerated.giftCard.status, 'active')
  assert.equal(userGenerated.giftCard.ownerId, undefined)

  const userGeneratedCard = await giftCards.findGiftCardByCode(userGenerated.giftCard.code)
  assert.equal(userGeneratedCard?.ownerId, owner.id)
  assert.equal(userGeneratedCard?.createdById, owner.id)

  await expectError(() => giftCards.redeemGiftCard(userGenerated.giftCard.code, owner.id), 'GIFT_CARD_SELF_REDEEM')

  const userGeneratedRedeem = await giftCards.redeemGiftCard(userGenerated.giftCard.code, recipient.id)
  assert.equal(userGeneratedRedeem.balanceValue, 20)
  assert.equal(userGeneratedRedeem.balanceBefore, 12.34)
  assert.equal(userGeneratedRedeem.balanceAfter, 32.34)

  const ownerCards = await giftCards.listGiftCardsByUser(owner.id, { page: 1, pageSize: 20 })
  assert.ok(ownerCards.records.some(card => card.id === userGenerated.giftCard.id))

  await expectError(
    () => giftCards.generateGiftCardFromBalance({ userId: owner.id, faceValue: 1000, remark: `${runId}:insufficient` }),
    'GIFT_CARD_INSUFFICIENT_BALANCE'
  )

  const batch = await giftCards.createGiftCardBatch(2, {
    faceValue: 3,
    balanceValue: 3,
    remark: `${runId}:admin-batch`
  })
  assert.equal(batch.count, 2)
  assert.equal(new Set(batch.codes.map(card => card.code)).size, 2)

  const batchList = await giftCards.listGiftCardsByAdmin({ page: 1, pageSize: 10, batchId: batch.batchId, revealCode: true })
  assert.equal(batchList.total, 2)
  assert.ok(batchList.records.every(card => card.code.startsWith('gc-')))

  const batchDisable = await giftCards.batchDisableGiftCards(batch.codes.map(card => card.id))
  assert.equal(batchDisable.count, 2)

  const expiredCard = await giftCards.createGiftCard({
    faceValue: 1,
    balanceValue: 1,
    expiresAt: new Date(Date.now() - 60_000),
    remark: `${runId}:expired`
  })
  await expectError(() => giftCards.redeemGiftCard(expiredCard.code, recipient.id), 'GIFT_CARD_EXPIRED')
  const expiredAfterRedeem = await giftCards.findGiftCardByCode(expiredCard.code)
  assert.equal(expiredAfterRedeem?.status, 'expired')

  const recipientAfter = await prisma.user.findUniqueOrThrow({
    where: { id: recipient.id },
    select: { balance: true }
  })
  assert.equal(Number(recipientAfter.balance), 32.34)

  const ownerAfter = await prisma.user.findUniqueOrThrow({
    where: { id: owner.id },
    select: { balance: true }
  })
  assert.equal(Number(ownerAfter.balance), 80)

  console.log('gift card flow checks passed')
}

try {
  await main()
} finally {
  await cleanup()
  await closePrismaDatabase()
}
