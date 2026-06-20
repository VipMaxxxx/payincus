import i18n from '@/locales'

type TranslateParams = Record<string, string | number>

function tr(key: string, params?: TranslateParams): string {
  const translate = i18n.global.t as (key: string, params?: TranslateParams) => string
  return translate(key, params)
}

export function getFreeSiteBillingCycleLabel(months: number | null | undefined): string {
  switch (months) {
    case 1:
      return tr('freeSite.billingCycleLabel.monthly')
    case 3:
      return tr('freeSite.billingCycleLabel.quarterly')
    case 6:
      return tr('freeSite.billingCycleLabel.semiAnnual')
    case 12:
      return tr('freeSite.billingCycleLabel.annual')
    default:
      return months
        ? tr('freeSite.billingCycleLabel.custom', { months })
        : tr('freeSite.billingCycleLabel.free')
  }
}

export function getFreeSiteBillingCycleShort(months: number | null | undefined): string {
  switch (months) {
    case 1:
      return tr('freeSite.billingCycleShort.monthly')
    case 3:
      return tr('freeSite.billingCycleShort.quarterly')
    case 6:
      return tr('freeSite.billingCycleShort.semiAnnual')
    case 12:
      return tr('freeSite.billingCycleShort.annual')
    default:
      return months ? tr('freeSite.billingCycleShort.custom', { months }) : ''
  }
}

const freeSiteCopyKeys = [
  'finalPrice',
  'renewPrice',
  'billingCycle',
  'needPay',
  'originalPrice',
  'oldDailyPrice',
  'newDailyPrice',
  'remainingValue',
  'newPlanCost',
  'currentBalance',
  'balanceAfterRenew',
  'walletBalanceTab',
  'walletLogsTab',
  'walletCurrentBalance',
  'walletDescription',
  'walletLogsDescription',
  'walletTotalRecharge',
  'walletTotalConsume',
  'walletDestroyedValue',
  'dashboardNewInstance',
  'dashboardCreateInstance',
  'dashboardCreateFirst',
  'dashboardUserBalance',
  'dashboardBalanceValue',
  'dashboardNewContainer',
  'instanceCreate',
  'instanceCreateFirst',
  'instanceBatchRenewTitle',
  'instanceBatchRenewDescription',
  'instanceBatchTotalAmount',
  'instanceBatchBalanceAfter',
  'instanceBatchCurrentBalance',
  'instanceBatchRenewAction',
  'moneyJustForShow',
  'marketPriceFree',
  'marketPlanCount',
  'marketCreateNow',
  'marketLoginToOrder',
  'marketSelectedPlanTitle',
  'marketCycleMonthly',
  'marketMonthlyPrice',
  'createOrderSummary',
  'createPromoCode',
  'createPromoPlaceholder',
  'createPromoHostedDisabled',
  'createPromoValid',
  'createPromoUsing',
  'createPromoBenefit',
  'createCommissionEstimate',
  'createPlanFee',
  'createMonthlyEquivalent',
  'mailPrice',
  'mailCheckoutTitle',
  'mailBillingCycle',
  'mailCheckoutAmount',
  'mailCheckoutConfirm',
  'mailBalanceRequired',
] as const

type FreeSiteCopyKey = typeof freeSiteCopyKeys[number]
type FreeSiteCopy = Record<FreeSiteCopyKey, string>

export const freeSiteCopy = {} as FreeSiteCopy

for (const key of freeSiteCopyKeys) {
  Object.defineProperty(freeSiteCopy, key, {
    enumerable: true,
    get: () => tr(`freeSite.copy.${key}`)
  })
}
