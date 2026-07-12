已仅修改 `server/src/services/traffic-scheduler.ts`，将限速、预警、恢复路径的 `instanceEffectiveLimit` 改回 `instanceLimit`，值仍为 `getEffectiveLimit(..., extraTrafficQuota)`；原子抢占函数结构未改。

守卫结果：

- `test:traffic-notification-claim-guards`：通过
- `test:traffic-reset-locks`：通过
- `test:traffic-collector-status-guard`：通过
- `test:traffic-route-limit-guards`：失败

失败原因是现有 route 守卫仍逐字要求 `instanceEffectiveLimit`，与 claim 守卫要求的 `instanceLimit` 直接冲突。未通过注释或死代码规避守卫，也未改守卫、`instances.ts` 或其他文件。未 commit。
