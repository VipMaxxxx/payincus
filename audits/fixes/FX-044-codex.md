FX-044 已实现，未 commit/push/发版。

初始 `createInstanceAsync` 失败现在会创建 `taskId=null`、直接关联 `instanceId` 的 DeliveryAssuranceCase；记录脱敏失败原因及退款成功、无需退款、已退款、退款失败等状态。通过实例 advisory lock 与查重条件保证同一实例仅创建一个初始失败 case。case 会出现在保障中心，并支持人工标记恢复或关闭。无需修改 schema，也未碰 transfers 或回退 FX-040/049。

改动文件：

- [instances.ts](C:/Users/Administrator/Desktop/payinces/server/src/routes/instances.ts:6691)
- [admin-delivery.ts](C:/Users/Administrator/Desktop/payinces/server/src/routes/admin-delivery.ts:164)
- [test-delivery-center-guards.ts](C:/Users/Administrator/Desktop/payinces/server/scripts/test-delivery-center-guards.ts:92)

验证结果：

- server type-check：通过
- `test:instance-create-failure-compensation`：通过
- `git diff --check`：通过
- `test:delivery-center-guards`：本次新增的自动建 case/幂等断言通过，但随后被既有 `DeliveryCenterView.vue` 表格布局断言阻断；当前页面使用 `overflow-x-auto/min-w-[900px]`，与守卫要求的 `overflow-hidden/table-fixed` 不符。该前端文件不在本任务授权范围，未越界修改。
