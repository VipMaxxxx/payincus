# 表格漂移恢复:client/src/views/admin/OAuthConfigView.vue(oauth-provider-guards FAIL)

## 硬约束(memory + AGENTS.md §4)
锁定表只能"移动卡 + PC 定宽表(table-fixed/overflow-hidden,禁横滚)";禁 overflow-x-auto/min-w-[...]。**不许改/弱化守卫**,只改 .vue。

## 修法(只改 client/src/views/admin/OAuthConfigView.vue;不改守卫;不碰后端)
1. 先只读 server/scripts/test-oauth-provider-guards.ts 中该表确切断言(移动卡+桌面定宽表的 class/结构);client/src/views/admin/OAuthConfigView.vue 当前表结构。
2. 恢复:移动卡(block lg:hidden)+ 桌面定宽表(hidden overflow-hidden lg:block + table-fixed,列宽合计100%,允许换行),去 overflow-x-auto/min-w;功能/@click 100% 不变。
3. 反复跑 test:oauth-provider-guards 直到该表断言通过。

## 验收
test:oauth-provider-guards 通过;test:frontend-route-guards、test:frontend-dist-boundary-guards、client type-check 通过。不 commit。
