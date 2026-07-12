FX-073 已完成：申领改为 DB 事务先落库并写入 pending 标记，再 patch Incus，成功后清除标记；启动及每 5 分钟仅对 pending 记录进行幂等比对和重放，避免崩溃漂移。资源池余额、申领返回 `amount`、日志 `amount` 均改为字符串透传，移除了 `BigInt → Number` 精度风险。

验证通过：server type-check、`resource-pool-apply-consistency`、`resource-quota-bigint-guards`、`host-resource-atomic-guards`。未改 schema/package，未触碰并行文件，未 commit/push/发版。
