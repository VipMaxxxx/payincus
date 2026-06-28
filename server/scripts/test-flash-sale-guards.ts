import { readFileSync } from 'fs'
import { resolve } from 'path'

function read(path: string): string {
  return readFileSync(resolve(new URL('../..', import.meta.url).pathname, path), 'utf8')
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
const adminViewSource = read('client/src/views/admin/FlashSalesView.vue')

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
    serviceSource.includes('!item.allowCoupon || !item.allowAff'),
  'Flash sale checkout must block coupons and AFF unless both are allowed'
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

console.log('flash sale guard checks passed')
