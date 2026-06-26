import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

const schema = read('server/prisma/schema.prisma')
const migration = read('server/prisma/migrations/20260625210000_add_gift_cards/migration.sql')
const locks = read('server/src/db/advisory-locks.ts')
const db = read('server/src/db/gift-cards.ts')
const route = read('server/src/routes/gift-cards.ts')
const app = read('server/src/app.ts')
const clientApi = read('client/src/api/index.ts')
const adminApi = read('client/src/api/admin.ts')
const clientTypes = read('client/src/types/api.ts')
const userRouter = read('client/src/router/user.ts')
const adminRouter = read('client/src/router/admin.ts')
const userView = read('client/src/views/GiftCardsView.vue')
const adminView = read('client/src/views/admin/GiftCardsView.vue')
const turnstileWidget = read('client/src/components/TurnstileWidget.vue')
const userNav = read('client/src/config/side-nav-items-user.ts')
const adminNav = read('client/src/config/side-nav-items-admin.ts')
const serverPackage = read('server/package.json')
const rootPackage = read('package.json')

assert(
  schema.includes('model GiftCard') &&
    schema.includes('enum GiftCardStatus') &&
    schema.includes('giftCardsCreated') &&
    schema.includes('giftCardsOwned') &&
    schema.includes('giftCardsUsed') &&
    migration.includes('CREATE TYPE "GiftCardStatus"') &&
    migration.includes('CREATE TABLE "gift_cards"') &&
    migration.includes('CREATE UNIQUE INDEX "gift_cards_code_key"'),
  'gift card schema and migration must persist code status, ownership, usage, batch, and user relations'
)

assert(
  locks.includes('export const GIFT_CARD_LOCK_NAMESPACE') &&
    db.includes('await advisoryTransactionLock(tx, GIFT_CARD_LOCK_NAMESPACE, initialGiftCard.id)') &&
    db.includes('await advisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, userId)') &&
    db.includes('await advisoryTransactionLock(tx, USER_BALANCE_LOCK_NAMESPACE, input.userId)'),
  'gift card balance and redeem flows must use advisory locks for card state and user balance'
)

const userGenerateSection = db.slice(
  db.indexOf('export async function generateGiftCardFromBalance'),
  db.indexOf('export async function findGiftCardByCode')
)

assert(
  userGenerateSection.includes('where: { id: input.userId, balance: { gte: amount } }') &&
    userGenerateSection.includes("type: 'consume'") &&
    userGenerateSection.includes('amount: toDecimal(-amount)') &&
    userGenerateSection.includes('createGiftCardInTransaction(tx') &&
    !route.includes('const result = await prisma.$transaction') &&
    !route.includes('data: { balance: { decrement: faceValue } }'),
  'user-generated gift cards must deduct balance atomically in the DB layer and create a balance log in the same transaction'
)

const redeemSection = db.slice(
  db.indexOf('export async function redeemGiftCard'),
  db.indexOf('export async function disableGiftCard')
)

assert(
  redeemSection.includes("if (giftCard.ownerId === userId)") &&
    redeemSection.includes("throw new Error('GIFT_CARD_SELF_REDEEM')") &&
    redeemSection.includes("where: { id: giftCard.id, status: 'active' }") &&
    redeemSection.includes("return { error: 'GIFT_CARD_EXPIRED' }") &&
    db.includes("if ('error' in result)") &&
    redeemSection.includes("type: 'gift'") &&
    redeemSection.includes('maskGiftCardCode(giftCard.code)'),
  'gift card redemption must reject self redemption, persist expired status, claim active codes atomically, credit balance, and avoid logging full codes'
)

assert(
  route.includes('function requireGiftCardManager') &&
    route.includes('PAYINCUS_GIFT_CARD_ADMIN_IDS') &&
    route.includes('requireGiftCardManager]') &&
    route.includes('normalizeIdList') &&
    db.includes('maskGiftCardCode(code)') &&
    db.includes('revealCode: options.revealCode === true'),
  'admin gift card routes must require an explicit production allowlist, normalize batch IDs, and mask list codes by default'
)

const adminGenerateSection = route.slice(
  route.indexOf("fastify.post('/admin/generate'"),
  route.indexOf('// 批量生成兑换码')
)
const adminBatchSection = route.slice(
  route.indexOf("fastify.post('/admin/batch'"),
  route.indexOf('// 管理员列表')
)
const userRedeemSection = route.slice(
  route.indexOf("fastify.post('/user/redeem'"),
  route.indexOf('// 用户用余额生成兑换码')
)
const userGenerateRouteSection = route.slice(
  route.indexOf("fastify.post('/user/generate'"),
  route.indexOf('// 用户查看自己的兑换码')
)

assert(
  adminGenerateSection.includes('requireGiftCardManager') &&
    adminBatchSection.includes('requireGiftCardManager') &&
    !adminGenerateSection.includes('turnstileRequired') &&
    !adminBatchSection.includes('turnstileRequired') &&
    !adminView.includes('useTurnstile') &&
    !adminView.includes('turnstileToken'),
  'admin gift card generation must rely on admin auth, explicit allowlist, and rate limits, not frontend Turnstile tokens'
)

assert(
  userRedeemSection.includes('turnstileRequired') &&
    userGenerateRouteSection.includes('turnstileRequired') &&
    userView.includes("import TurnstileWidget from '@/components/TurnstileWidget.vue'") &&
    userView.includes('api.systemConfig.getPublic()') &&
    userView.includes('v-model="turnstileToken"') &&
    userView.includes('turnstileRef.value?.getToken?.()') &&
    userView.includes('input[name="cf-turnstile-response"]') &&
    userView.includes('@verify="onTurnstileVerify"') &&
    turnstileWidget.includes("@update:model-value=\"onVerify\"") &&
    turnstileWidget.includes('@expired="onExpire"') &&
    userView.includes('请先完成人机验证'),
  'user gift card redemption and balance-funded generation must keep visible Turnstile protection and reliably submit the widget token'
)

assert(
  app.includes("await fastify.register(giftCardsRoutes, { prefix: '/api/gift-cards' })") &&
    clientTypes.includes('export interface GiftCardRecord') &&
    clientApi.includes('giftCards:') &&
    clientApi.includes("http.post('/gift-cards/user/redeem'") &&
    clientApi.includes("http.post('/gift-cards/user/generate'") &&
    clientApi.includes("http.get('/gift-cards/user/mine'") &&
    adminApi.includes('giftCards:') &&
    adminApi.includes("http.post('/gift-cards/admin/generate'") &&
    adminApi.includes("http.post('/gift-cards/admin/batch'") &&
    userRouter.includes("path: '/gift-cards'") &&
    adminRouter.includes("path: '/admin/gift-cards'") &&
    userNav.includes("path: '/gift-cards'") &&
    adminNav.includes("path: '/admin/gift-cards'") &&
    userView.includes('TurnstileWidget') &&
    userView.includes('兑换礼品卡') &&
    adminView.includes('PAYINCUS_GIFT_CARD_ADMIN_IDS') &&
    adminView.includes('显示完整兑换码') &&
    serverPackage.includes('"test:gift-card-guards"') &&
    rootPackage.includes('pnpm --filter server test:gift-card-guards'),
  'gift card routes, client pages, API wrappers, nav entries, and guard script must be wired into the platform'
)

console.log('gift card guard checks passed')
