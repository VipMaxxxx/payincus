# FX-DISC-09 规格：ResourceRiskView.vue 表格漂移恢复(基线遗留,resource-risk-guards 前端断言 FAIL)

## 背景
UI 重做期把该管理端锁定表改成了 `overflow-x-auto`/`min-w-[...]` 横滚,丢了 `table-fixed`/移动卡,致 `test:resource-risk-guards` 断言"resource risk admin main lists must render mobile cards and fixed desktop tables" FAIL。本会话未碰过该文件(基线遗留)。

## 硬约束(项目 memory + AGENTS.md §4)
锁定表**只能**"移动卡 + PC 定宽表(`table-fixed`/`overflow-hidden`,绝不横向滚动)";**反向禁止** `overflow-x-auto`/`min-w-[...]`/去 `table-fixed`。**不许改/弱化守卫**,只改 .vue 恢复布局。

## 修法(只改 client/src/views/admin/ResourceRiskView.vue;不改守卫;不碰后端)
1. 先只读:`server/scripts/test-resource-risk-guards.ts` 中该表的**确切断言**(它检查哪些 class/结构:如 `hidden overflow-hidden lg:block` + `table-fixed` + 移动卡 `lg:hidden` 等);ResourceRiskView.vue 当前主列表结构。
2. **恢复锁定表布局**(严格满足守卫):
   - 移动端:卡片视图(`block lg:hidden` 之类),每行数据以卡片呈现;
   - 桌面端:定宽表(`hidden ... lg:block` + `table-fixed` + `overflow-hidden`),**列宽百分比合计=100%**,允许单元格换行,**去掉** `overflow-x-auto`/`min-w-[...]`;
   - 功能/数据/@click 路径 100% 不变,只改布局 class 与结构。
3. 反复跑 `test:resource-risk-guards` 直到该表断言通过(注意该守卫还有后端断言,应一并绿)。

## 验收
`test:resource-risk-guards` 通过;`test:frontend-route-guards`、`test:frontend-dist-boundary-guards` 通过;client type-check 通过。交付一段话:恢复了哪些 class、列宽分配、守卫结果。不 commit。
