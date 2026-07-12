import { readFileSync } from 'fs'
import { resolve } from 'path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

const appSource = read('server/src/app.ts')
const routeSource = read('server/src/routes/flash-sales.ts')
const serviceSource = read('server/src/services/flash-sales.ts')
const instancesSource = read('server/src/routes/instances.ts')
const adminApiSource = read('client/src/api/admin.ts')
const adminViewSource = read('client/src/views/admin/FlashSalesView.vue')
const userViewSource = read('client/src/views/FlashSalesView.vue')
const enLocaleSource = read('client/src/locales/en.ts')
const zhCnLocaleSource = read('client/src/locales/zh-CN.ts')
const zhTwLocaleSource = read('client/src/locales/zh-TW.ts')

assert(
  appSource.includes("import flashSaleRoutes from './routes/flash-sales.js'") &&
    appSource.includes('fastify.register(flashSaleRoutes, { prefix: \'/api\' })'),
  'Flash sale routes must be registered under the /api prefix'
)

assert(
  routeSource.includes("fastify.get('/flash-sales', {\n    onRequest: [fastify.authenticate]"),
  'User flash sale campaign list must require authentication'
)

assert(
  routeSource.includes("'/admin/flash-sales'") &&
    routeSource.includes("'/admin/flash-sales/:id'") &&
    routeSource.includes("'/admin/flash-sales/items/:itemId/stock'") &&
    routeSource.includes('onRequest: [fastify.authenticate, fastify.requireAdmin]'),
  'Admin flash sale routes must exist and require admin authentication'
)

assert(
  serviceSource.includes('FLASH_SALE_ITEM_LOCK_NAMESPACE') &&
    serviceSource.includes('advisoryTransactionLock(tx, FLASH_SALE_ITEM_LOCK_NAMESPACE, input.itemId)'),
  'Flash sale purchase claims must lock per item inside the transaction'
)

assert(
  serviceSource.includes('flashPrice <= 0 || flashPrice >= originalPrice') &&
    serviceSource.includes('assertValidFlashPrice(item.flashPrice, plan.price)') &&
    serviceSource.includes('assertValidFlashPrice(input.flashPrice, item.originalPriceSnapshot)') &&
    adminViewSource.includes('flashPriceCents > 0 && flashPriceCents < Number(originalPriceCents)'),
  'FX-080: Flash sale create and edit must enforce 0 < flash price < original price on server and admin UI'
)

assert(
  userViewSource.includes("t('flashSales.firstTermOnly')") &&
    enLocaleSource.includes('Flash sale price applies to the first term only; renewals return to the original price.') &&
    zhCnLocaleSource.includes('仅首期秒杀价，续费按原价。') &&
    zhTwLocaleSource.includes('僅首期秒殺價，續費按原價。'),
  'FX-080: User flash sale checkout must clearly disclose first-term-only pricing in all three locales'
)

assert(
  serviceSource.includes('advisoryTransactionLock(tx, FLASH_SALE_ITEM_LOCK_NAMESPACE, itemId)') &&
    serviceSource.includes('priceSnapshot.flashPriceCents !== currentFlashPriceCents') &&
    serviceSource.includes('Math.round(input.amount * 100) !== expectedAmountCents') &&
    serviceSource.includes("'FLASH_SALE_PRICE_CHANGED'") &&
    instancesSource.includes('flashPriceCents: flashSaleCheckout.flashPrice'),
  'D-060: Price updates and claims must share the item lock and claims must bind the quoted/current price and charged amount'
)

assert(
  serviceSource.includes('remainingStock(item) <= 0') &&
    serviceSource.includes('FLASH_SALE_SOLD_OUT') &&
    serviceSource.includes('FLASH_SALE_USER_LIMIT_REACHED'),
  'Flash sale checkout must enforce stock and per-user limits'
)

assert(
  serviceSource.includes('getActiveOrderRestriction(input.userId)') &&
    serviceSource.includes('FLASH_SALE_ORDER_RESTRICTED') &&
    serviceSource.includes('verifyTurnstileToken('),
  'Flash sale checkout must enforce risk restriction and Turnstile guards'
)

assert(
  serviceSource.includes('FLASH_SALE_COUPON_DISABLED') &&
    serviceSource.includes('if (input.promoCode && !item.allowAff)') &&
    !serviceSource.includes('!item.allowCoupon || !item.allowAff') &&
    instancesSource.includes('if (flashSaleCheckout && !flashSaleCheckout.allowAff)'),
  'BF-8-03: Flash sale AFF eligibility must depend on allowAff independently of allowCoupon'
)

assert(
  (serviceSource.match(/normalizeStatusForTime\(item\.campaign\.status, item\.campaign\.startAt, item\.campaign\.endAt, now\) !== 'active'/g)?.length ?? 0) === 2 &&
    !serviceSource.includes("item.campaign.status !== 'active' || now < item.campaign.startAt"),
  'BF-8-01: Scheduled flash sales must become purchasable lazily once startAt is reached'
)

assert(
  (serviceSource.match(/campaignId: item\.campaignId/g)?.length ?? 0) >= 2 &&
    (serviceSource.match(/campaignPurchasedCount >= campaignMaxPerUser/g)?.length ?? 0) === 2 &&
    serviceSource.includes('advisoryTransactionLock(tx, FLASH_SALE_ITEM_LOCK_NAMESPACE, -item.campaignId)'),
  'BF-8-02: Campaign maxPerUser must count purchases across all campaign items under a campaign lock'
)

assert(
  instancesSource.includes('assertFlashSaleCheckoutEligibility') &&
    instancesSource.includes('claimFlashSalePurchaseInTransaction') &&
    instancesSource.includes('markFlashSaleDelivered') &&
    instancesSource.includes('markFlashSaleFailed') &&
    instancesSource.includes('FLASH_SALE_DUPLICATE_REQUEST'),
  'Instance creation must integrate flash sale eligibility, transaction claim, delivery updates and idempotency handling'
)

assert(
  serviceSource.includes("status: { in: ['paid', 'delivering'] }") &&
    serviceSource.includes('const updateResult = await tx.flashSaleReservation.updateMany({') &&
    serviceSource.includes('if (updateResult.count === 0) return') &&
    serviceSource.indexOf('if (updateResult.count === 0) return') <
      serviceSource.indexOf('failedCount: { increment: 1 }'),
  'Flash sale failure release must atomically claim an active reservation before rolling back sold stock'
)

assert(
  instancesSource.includes('const affCommissionBasePrice = flashSaleCheckout') &&
    instancesSource.includes('flashSaleCheckout.flashPrice / 100'),
  'Flash sale AFF commission must use flash sale price as the commission base'
)

assert(
  adminViewSource.includes('form.value.items') &&
    adminViewSource.includes('addFlashSaleItem') &&
    adminViewSource.includes('removeFlashSaleItem') &&
    adminViewSource.includes('allowAff') &&
    adminViewSource.includes('validItems.map((item, index)'),
  'Admin flash sale UI must support multiple items and per-item coupon/AFF settings'
)

assert(
  routeSource.includes("fastify.patch<{") &&
    routeSource.includes("'/admin/flash-sales/items/:itemId'") &&
    routeSource.includes('updateFlashSaleItemConfig(itemId, input)') &&
    serviceSource.includes('export async function updateFlashSaleItemConfig') &&
    serviceSource.includes('FLASH_SALE_STOCK_BELOW_SOLD') &&
    adminApiSource.includes('updateItem: (itemId: number') &&
    adminViewSource.includes('beginEditCampaign') &&
    adminViewSource.includes('saveCampaignContent') &&
    adminViewSource.includes('beginEditItem') &&
    adminViewSource.includes('saveItemContent') &&
    adminViewSource.includes('已有订单记录不回改，后续购买按新配置执行'),
  'Admin flash sale UI and API must allow editing generated campaign content and item settings'
)

assert(
  adminViewSource.includes('table class="w-full table-fixed divide-y divide-themed text-sm"') &&
    adminViewSource.includes('table class="w-full table-fixed divide-y divide-themed text-sm"') &&
    (adminViewSource.match(/class="space-y-3 p-4 lg:hidden"/g)?.length ?? 0) >= 2 &&
    (adminViewSource.match(/class="hidden overflow-hidden lg:block"/g)?.length ?? 0) >= 2 &&
    !adminViewSource.includes('class="overflow-x-auto"') &&
    !adminViewSource.includes('table class="min-w-full'),
  'Admin flash sale item and reservation tables must keep mobile cards and fixed desktop tables without broad horizontal overflow'
)

assert(
  adminViewSource.includes('v-model.number="item.packagePlanId"') &&
    adminViewSource.includes('v-model.number="item.flashPrice"') &&
    adminViewSource.includes('v-model.number="item.totalStock"') &&
    adminViewSource.includes('v-model.number="item.perUserLimit"') &&
    adminViewSource.includes('v-model="item.allowCoupon"') &&
    adminViewSource.includes('v-model="item.allowAff"') &&
    adminViewSource.includes('@click="removeFlashSaleItem(index)"') &&
    adminViewSource.includes('@click="loadReservations(selectedCampaign.id)"'),
  'Admin flash sale responsive layout must preserve item edit fields, deletion, and reservation refresh actions'
)

console.log('flash sale guard checks passed')
