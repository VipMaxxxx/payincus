已完成，仅修改 [OrdersView.vue](C:/Users/Administrator/Desktop/payinces/client/src/views/admin/OrdersView.vue:648)。

- 两张表恢复“移动卡 + PC 定宽表”
- 桌面容器恢复 `hidden overflow-hidden lg:block`
- 表格恢复 `w-full table-fixed`
- 列宽均合计 100%，单元格允许换行
- 移除表格横滚及 `min-w-[900px]`
- 所有 `@click` 与业务逻辑保持不变
- `git diff --check` 通过
- 未 commit

验收全部通过：

- `test:order-center-guards`
- `test:frontend-route-guards`
- `test:frontend-dist-boundary-guards`
- `client type-check`
