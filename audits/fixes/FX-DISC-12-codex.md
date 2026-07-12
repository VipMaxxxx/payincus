已完成 FX-DISC-12，仅修改 [SlaAlertsView.vue](C:/Users/Administrator/Desktop/payinces/client/src/views/admin/SlaAlertsView.vue:361)。

改动：

- 恢复移动卡 + PC 定宽表布局。
- 桌面容器改为 `hidden overflow-hidden lg:block`。
- 表格恢复 `w-full table-fixed`，列宽维持合计 100%。
- 移除 `overflow-x-auto`、`min-w-[900px]` 和桌面单元格截断，允许换行。
- 所有 `@click` 行为保持不变。

验收全部通过：

- `test:sla-alert-guards` ✅（包含 BF-11-status）
- `test:frontend-route-guards` ✅
- `test:frontend-dist-boundary-guards` ✅
- `client type-check` ✅

未修改守卫或后端，未 commit。工作区原有大量其他未提交改动，均未触碰。
