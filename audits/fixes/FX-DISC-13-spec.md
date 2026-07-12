# FX-DISC-13 规格：HostingView.vue 表格漂移恢复(admin-hosting-route-id-guards FAIL)

## 硬约束(memory + AGENTS.md §4)
锁定表只能移动卡+PC定宽表(table-fixed/overflow-hidden,禁横滚);禁 overflow-x-auto/min-w。不改守卫,只改 .vue。

## 修法(只改 client/src/views/admin/HostingView.vue;不改守卫;不碰后端)
1. 先只读 server/scripts/test-admin-hosting-route-id-guards.ts 该表确切断言;HostingView.vue 当前表结构。
2. 恢复:移动卡(block lg:hidden)+桌面定宽表(hidden overflow-hidden lg:block + table-fixed,列宽合计100%,允许换行),去 overflow-x-auto/min-w;功能/@click 不变。
3. 反复跑 test:admin-hosting-route-id-guards 直到通过(含 BF-10-03 后端断言一并绿)。

## 验收
test:admin-hosting-route-id-guards、test:frontend-route-guards、test:frontend-dist-boundary-guards、client type-check 通过。不 commit。
