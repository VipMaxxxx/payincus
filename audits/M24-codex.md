# M24 审计报告
## 结论摘要
管理端路由的基础管理员鉴权总体完整，批量配置也校验了宿主机归属，但运营数据、自动快照及批量资源变更存在高风险正确性问题。最严重的是套餐收入单位放大 100 倍、自动快照在副作用成功后仍可能重试，以及批量配置造成 Incus 与数据库状态永久分叉。

## 发现清单
- [M24-01] P1 | 置信度 高 | server/src/routes/admin-capacity-cost.ts:415
  - 问题:套餐价格以“分”存储，却被直接当作“元”计算并展示月收入和毛利，收入被放大 100 倍。
  - 证据:`const monthlyRevenue = toMoney(plan.price) / Math.max(plan.billingCycle || 1, 1)`；而 `server/src/db/package-plans.ts:359` 明确写有 `const price = Number(plan.price) || 0  // 分`，同类管理端代码也使用 `Number(plan.price) / plan.billingCycle / 100`。
  - 影响:低毛利或亏损套餐会被显示成高毛利，亏损预警基本失效，可能直接误导定价和扩容决策。
  - 修复建议:统一金额单位，在进入容量成本模型前将套餐价格由分转换为元，并补充跨单位口径守卫。

- [M24-02] P1 | 置信度 高 | server/src/services/auto-policy-scheduler.ts:151
  - 问题:重试范围覆盖了创建快照之后的数据库、通知和日志操作；任何后置操作失败都会再次创建快照。
  - 证据:`await createIncusSnapshot(...)` 后依次执行数据库记录、策略更新时间、通知和日志（151-190 行），这些操作全部位于同一个 `try` 中，195-200 行捕获任意错误后重新执行整个循环。
  - 影响:通知或日志短暂失败即可产生重复快照；达到配额时，每次重试还会再次删除旧快照，可能误删用户保留的快照并留下 Incus 孤儿快照。
  - 修复建议:只重试可安全幂等的 Incus 创建阶段，并为快照名称/数据库记录建立幂等键；后置通知与日志应独立失败处理。

- [M24-03] P1 | 置信度 高 | server/src/routes/batch-config.ts:407
  - 问题:单实例批量更新不是原子操作，先修改 Incus，后修改数据库，失败时没有补偿或状态标记。
  - 证据:407-562 行先调用 `patchInstanceResources`、`updateInstance` 修改 Incus，565-621 行才更新数据库；630 行统一捕获错误并仅返回 `success: false`。
  - 影响:高级配置或数据库更新失败时，接口报告失败但部分 Incus 配置已经生效，实例资源、宿主机台账和实际运行状态永久不一致；用户重试还可能重复施加副作用。
  - 修复建议:为每个实例采用可恢复的状态机，记录阶段进度并在失败时补偿或安排强制对账。

- [M24-04] P1 | 置信度 高 | server/src/routes/batch-config.ts:304
  - 问题:宿主机资源用量基于请求开始时读取的旧值执行绝对覆盖，并发批量操作会丢失更新。
  - 证据:使用 `cpuUsed: host.cpu_used + totalCpuDelta`、`memoryUsed: host.memory_used + totalMemoryDelta`；`server/src/db/hosts.ts:485-487` 又将这些值直接赋给数据库字段，而非原子增量。
  - 影响:同一宿主机上的两个并发批量修改可能互相覆盖，导致容量台账少算或多算，进而错误放行实例、显示虚假余量或触发错误告警。
  - 修复建议:在数据库事务中使用原子 `increment`，或加宿主机级锁并在提交前重新计算资源用量。

- [M24-05] P1 | 置信度 高 | server/src/routes/admin-sla-alerts.ts:298
  - 问题:SLA 规则的严重级别、阈值和合并窗口可被保存，但扫描执行时基本不读取这些配置。
  - 证据:`upsertDetection` 只检查 `rule.enabled` 和 `rule.silenceUntil`，写入时使用 `severity: detection.severity`；检测窗口固定使用 `RECENT_LOOKBACK_HOURS`、`AGENT_STALE_MINUTES`，`thresholdMinutes`、`thresholdCount`、`dedupeMinutes` 仅在规则更新接口中保存。
  - 影响:管理员修改严重级别或阈值后界面显示保存成功，实际告警行为完全不变，可能漏掉应升级的事故或持续产生不符合配置的告警。
  - 修复建议:让扫描和合并逻辑以持久化规则为唯一参数来源，并为每个可编辑字段增加行为级守卫。

- [M24-06] P1 | 置信度 中 | server/src/services/system-monitor.ts:151
  - 问题:webhook 仅在请求前解析并校验目标，没有使用连接期重新校验 DNS 的安全 dispatcher，仍存在 DNS rebinding 窗口。
  - 证据:`fetch(webhookUrl.toString(), {... redirect: 'manual' })` 未传入 `safeOutboundDispatcher`；`outbound-security.ts:159-191` 明确说明该 dispatcher 用于消除校验与连接之间的 TOCTOU 窗口。
  - 影响:已配置 webhook 的域名若被恶意控制或 DNS 被劫持，可在初次校验后解析到内网、回环或云元数据地址，形成服务端请求伪造。
  - 修复建议:和 Lsky 探测一致，在 webhook fetch 中强制使用连接期 DNS 复核 dispatcher。

- [M24-07] P2 | 置信度 高 | server/src/routes/admin-sla-alerts.ts:766
  - 问题:单条告警的静默时间被写入事件，但后续扫描从不检查该字段。
  - 证据:静默接口设置 `silencedUntil`；而 `upsertDetection` 在304行查询既有事件后只判断规则级 `rule.silenceUntil`，随后仍更新事件并增加 `triggerCount`、写入 `merged` 动作。
  - 影响:管理员看到“静默”成功后，后续扫描仍持续合并并刷新该告警，静默操作与审计记录不可信。
  - 修复建议:合并前检查事件级 `silencedUntil`，并明确定义静默期间是否计数及何时恢复。

- [M24-08] P2 | 置信度 高 | server/src/routes/admin-capacity-cost.ts:286
  - 问题:容量概览 GET 请求包含写操作，而且每次刷新都会把当前容量压力当作一次新的 SLA 触发。
  - 证据:GET `/overview` 内执行 `capacitySnapshot.upsert`，随后调用 `syncHostCapacityAlertsToSla`；既有事件在266-279行无条件 `triggerCount: { increment: 1 }` 并新增 `merged` 动作。
  - 影响:浏览器刷新、预取或多管理员同时查看都会人为放大触发次数、污染审计历史；并发首次查看还可能在“先查询后创建”处触发唯一键冲突。
  - 修复建议:把快照采集和 SLA 同步移入独立调度任务，GET 仅执行只读查询，并按真实检测周期去重。

- [M24-09] P2 | 置信度 中 | server/src/routes/admin-integrations.ts:487
  - 问题:插件市场和主题市场健康探测调用的外部 fetch 没有连接期地址复核、禁止重定向或明确超时。
  - 证据:`checkPluginMarket`/`checkThemeMarket` 直接调用市场加载函数；`plugin-market.ts:328` 和 `theme-market.ts:277` 的 `fetch(parsed, { headers })` 未设置 `redirect: 'manual'`、`safeOutboundDispatcher` 或 `AbortSignal`。
  - 影响:受信市场域名被控制、DNS 重绑定或返回恶意重定向时可探测内网；网络半开时“一键检测”的 `Promise.all` 还可能长时间占用请求并使整个检测页面卡住。
  - 修复建议:所有市场探测统一走 outbound-security，并强制连接期复核、手动重定向和可取消超时。
