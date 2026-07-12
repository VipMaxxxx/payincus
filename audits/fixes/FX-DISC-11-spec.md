# FX-DISC-11 规格：DeliveryCenterView.vue 表格漂移恢复(基线遗留,delivery-center-guards FAIL)

## 背景
该管理端锁定表用了 `overflow-x-auto`/`min-w-[900px]` 移动横滚,丢 `table-fixed`+移动卡,致 `test:delivery-center-guards` 断言"delivery center must use mobile cards and fixed desktop tables instead of mobile horizontal table scrolling" FAIL。本会话未碰(基线遗留)。

## 硬约束(项目 memory + AGENTS.md §4)
锁定表只能"移动卡 + PC 定宽表(`table-fixed`/`overflow-hidden`,禁横滚)";禁 `overflow-x-auto`/`min-w-[...]`。**不许改/弱化守卫**。

## 修法(只改 client/src/views/admin/DeliveryCenterView.vue;不改守卫;不碰后端)
1. 先只读:`server/scripts/test-delivery-center-guards.ts` 该表确切断言;DeliveryCenterView.vue 当前表结构。
2. **恢复锁定表布局**:移动卡(`block lg:hidden`)+ 桌面定宽表(`hidden overflow-hidden lg:block` + `table-fixed`,列宽合计100%,允许换行),去 `overflow-x-auto`/`min-w-[900px]`;功能/@click 不变。
3. 反复跑 `test:delivery-center-guards` 直到通过(该守卫还有 FX-043/044 的后端断言,应一并绿)。

## 验收
`test:delivery-center-guards` 通过;`test:frontend-route-guards`、`test:frontend-dist-boundary-guards`、client type-check 通过。交付一段话:恢复的 class/列宽、守卫结果。不 commit。
