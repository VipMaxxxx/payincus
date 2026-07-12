# 表格漂移恢复:GiftCardsView(用户+管理)(gift-card-guards FAIL)

## 失败断言(test-gift-card-guards.ts:228-249,大 AND)
需同时满足(用户 client/src/views/GiftCardsView.vue + 管理 client/src/views/admin/GiftCardsView.vue):
- 用户端:`class="mt-5 space-y-3 lg:hidden"`(移动卡)、`class="mt-5 hidden overflow-hidden lg:block"`+`class="w-full table-fixed text-sm"`(桌面定宽表)、`class="block truncate"`、`@click="toggleCodeReveal(card)"`、`@click="copyCode(card.code)"`、`t('giftCards.redeemTitle')`、TurnstileWidget、**不得**含 `class="w-full min-w-[860px] table-fixed text-sm"`;i18n `redeemTitle: '兑换礼品卡'`。
- 管理端:`t('giftCardsAdmin.description')`、`class="mt-5 space-y-3 lg:hidden"`、`class="mt-5 hidden overflow-hidden lg:block"`+`class="w-full table-fixed text-sm"`、`@change="toggleSelected(card.id, ($event.target as HTMLInputElement).checked)"`、`@click="updateCardStatus(card)"`、`@click="deleteCard(card)"`、`t('giftCardsAdmin.revealCode')`;i18n `revealCode: '显示完整兑换码'`、`PAYINCUS_GIFT_CARD_ADMIN_IDS`。

## 硬约束(memory + AGENTS.md §4)
锁定表只能移动卡+PC定宽表(table-fixed/overflow-hidden,禁横滚/禁 min-w)。**不许改/弱化守卫**,只改 .vue(+必要 i18n key 若被删)。

## 修法(只改 client/src/views/GiftCardsView.vue + client/src/views/admin/GiftCardsView.vue + 必要 locales;不改守卫;不碰后端)
1. 先只读 test-gift-card-guards.ts:228-249 全部子条件 + 两 .vue 当前结构,逐条比对缺哪些。
2. 恢复:移动卡 `space-y-3 lg:hidden` + 桌面 `hidden overflow-hidden lg:block`+`table-fixed`(去 `min-w-[860px]`),保留断言要求的 @click/@change/t() 调用与 truncate;若 i18n key(redeemTitle/revealCode)被删则补回三语。功能 100% 不变。
3. 反复跑 test:gift-card-guards 直到全 AND 通过。

## 验收
test:gift-card-guards、test:frontend-route-guards、test:frontend-dist-boundary-guards、test:frontend-i18n-keys、client type-check 通过。不 commit。
