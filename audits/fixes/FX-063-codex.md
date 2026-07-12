FX-063 已实现，未 commit/push/发版，未改 schema/package，也未触碰 instances。

- 仲裁点位于 [traffic-bandwidth.ts](C:/Users/Administrator/Desktop/payinces/server/src/services/traffic-bandwidth.ts:99)：配置线速、流量超量 `1Mbit`、风控 QoS 三者取最小值，并按实例分布式锁串行落地。
- 正常线速来自 `packagePlan.trafficLimitSpeed`，无方案时回退套餐 ingress/egress 配置；不再捕获实时带宽。
- [traffic-scheduler.ts](C:/Users/Administrator/Desktop/payinces/server/src/services/traffic-scheduler.ts:157) 只设置/清除 `trafficStatus=LIMITED`；[resource-risk.ts](C:/Users/Administrator/Desktop/payinces/server/src/services/resource-risk.ts:441) 只设置/清除 `currentBandwidthLimit`。任一约束解除后均按剩余约束重新仲裁，不恢复 `original`。
- 保留 FX-060 实例 80% 预警及 FX-066 风控衰减逻辑。

验证：

- server type-check：通过
- `test:plan-bandwidth-limit-guards`：通过
- `test:traffic-route-limit-guards`：通过
- `test:traffic-notification-claim-guards`：通过
- `test:resource-risk-guards`：新增 FX-063 断言通过，但随后在既有 `ResourceRiskView.vue` 桌面表格布局断言失败；当前并行页面已无守卫要求的 `hidden overflow-hidden lg:block` / `table-fixed` 类。本任务未修改该页面或弱化其守卫。
