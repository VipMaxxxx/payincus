已完成 FX-043，未 commit/push/发版。

修改：

- [managed-instance-provision.ts](C:/Users/Administrator/Desktop/payinces/server/src/lib/managed-instance-provision.ts)：托管代开通成功后补齐 IP 记录、目标用户站内信与邮件、`service.provisioned` 插件事件、秒杀交付标记。
- [test-delivery-center-guards.ts](C:/Users/Administrator/Desktop/payinces/server/scripts/test-delivery-center-guards.ts)：增加上述行为及秒杀不双计守卫。
- 未抽共享 helper：自营逻辑为内联，抽取会扩大高危路由改动范围。
- 秒杀仅调用一次现有幂等 `markFlashSaleDelivered`，不直接修改 `soldCount`。
- 后置动作独立容错，避免通知上下文失败误删已经成功运行的实例。

验证：

- `pnpm --filter server type-check`：通过
- `test:instance-create-failure-compensation`：通过
- `test:delivery-center-guards`：新增 FX-043 断言通过；随后被并行前端改动触发的既有桌面表格布局断言阻断。当前 `DeliveryCenterView.vue` 的固定桌面表匹配数为 0，本次未越界修改该文件。
- `git diff --check`：通过。
