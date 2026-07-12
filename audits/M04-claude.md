# M04 审计报告

## 结论摘要
核心计费链路(用户续费/升级 `performRenewal`/`performPlanChange`)整体防护较好:advisory 锁 + 条件扣款 + 实例版本乐观锁 + 守卫测试钉死了主要竞态。但发现一个 P1 级对账问题:到期自动删除对实例做硬删除,级联抹掉全部 `InstanceBillingRecord` 财务史料;另有多个 P2 集中在管理员侧计费操作(延期/退款/升级/删除退款)——普遍缺少版本锁、事务内复核和托管收入回扣,与用户侧路径的严谨程度不对称。

## 发现清单

- [M04-01] P1 | 置信度 高 | server/src/services/billing-scheduler.ts:520 · server/prisma/schema.prisma:4270
  - 问题:到期删除任务对实例硬删除,`InstanceBillingRecord.instance` = `onDelete: Cascade`,该实例全部消费/退款账单随之永久删除。
  - 证据:调度器 `await prisma.instance.delete({ where: { id: instance.id } })`(无条件硬删);而用户销毁(instance-destroy.ts:193)和管理员删除退款都只是置 `status:'deleted'` 软删,仅此路径硬删。
  - 影响:凡"到期→封停 3 天→自动删除"的实例(线上常态),其账单全部消失——订单中心丢单、管理端收入统计随时间倒缩水、历史对账漂移,财务证据链断裂。
  - 修复建议:到期删除改软删(或删除前归档账单/级联改保留),收入统计不依赖可被级联删的表。

- [M04-02] P2 | 置信度 高 | server/src/services/billing-scheduler.ts:468-522 · server/src/routes/instance-billing.ts:600-616 · server/src/db/billing-operations.ts:553-556
  - 问题:到期删除"认领→Incus删除窗口→无条件DB delete"期间用户仍可成功续费;认领条件不复核 expiresAt,失败恢复路径留下"已付费仍挂过期封停"次日再删。
  - 影响:删除窗口内续费→钱被扣、实例照删、账单消失;Incus 删除失败恢复场景下窗口内续费的实例次日仍被确定性删除。
  - 修复建议:续费路由与 performRenewal 显式拒绝 status==='deleted';DB 删除改带 version/status 条件 deleteMany;认领条件补 expiresAt<now 复核。

- [M04-03] P2 | 置信度 高 | server/src/routes/admin-billing.ts:788-799, 2384-2385
  - 问题:管理员延期日价口径为"月价(先四舍五入)÷30(再四舍五入)",与全系统统一 31天/月口径(billing-calc.ts CYCLE_DAYS)不一致,双重 toFixed 放大误差。
  - 影响:同一实例"付费延期31天"比"续费1个月"贵约3.3%,收费口径分叉,用户可比价发现被多收。
  - 修复建议:改用公共 billing-calc.calculateDailyPrice(31天口径),只对最终金额舍入一次。

- [M04-04] P2 | 置信度 高 | server/src/routes/admin-billing.ts:2388-2391, 2444-2456, 2475-2489
  - 问题:管理员延期 newExpiresAt 在事务外基于旧 expiresAt 计算,实例更新用无条件 tx.instance.update(不校验/不递增 version);免费延期分支连余额 advisory 锁都不取。
  - 影响:与用户并发续费竞态时,延期用陈旧基准覆盖 expiresAt,用户刚付费的一个月时长可被"延期1天"吞掉(钱已扣、时长丢失);不递增 version 绕开乐观锁。
  - 修复建议:基准读取与更新放进同一事务,改带 version 条件 updateMany。

- [M04-05] P2 | 置信度 高 | server/src/routes/admin-billing.ts:2581-2587, 2731-2747
  - 问题:管理员退款上限 maxRefundable 校验在事务外(TOCTOU),事务内不复核;/refund 与 /delete-and-refund 跨路由并发以同一快照通过;/refund 还缺实例状态与 exchange-lock 检查。
  - 影响:两次并发退款(双管理员/双击/与删除退款叠加)可合计超过历史实付总额,平台净亏,退款≤实付不变量被打破。
  - 修复建议:把 getMaxRefundable 校验移入退款事务内基于事务内快照重算,或对同一实例退款加实例级 advisory 锁。

- [M04-06] P2 | 置信度 高 | server/src/routes/admin-billing.ts:2677-2943(对照 instance-destroy.ts:312)
  - 问题:管理员"删除并退款"对托管节点实例退款时,不调用 deductHostingBalance 回扣节点主托管收入。
  - 影响:托管实例被管理员删除退款时,用户拿回钱、节点主保留收入,平台双边买单;托管收入账与退款账无法对齐。
  - 修复建议:退款事务中复用 deductHostingBalance,与用户端销毁一致回扣。

- [M04-07] P2 | 置信度 高 | server/src/routes/admin-billing.ts:5383-5386, 5471-5498(对照 billing-operations.ts:901-937)
  - 问题:管理员升级方案报价 calculatePlanChange 在事务外计算,事务内 tx.instance.update 无 version 条件且不递增 version;用户端 performPlanChange 则是 updateMany+version 乐观锁。
  - 影响:与用户并发续费/升级互为丢失更新,后提交方覆盖前者 billingPrice/packagePlanId,差价按陈旧快照多扣/少扣。
  - 修复建议:复用 db.performPlanChange 或补齐事务内重读+version 条件更新+递增。

- [M04-08] P3 | 置信度 高 | server/src/routes/orders.ts:401, 507-508
  - 问题:订单合并分页 take = page*pageSize,page 无上限,深分页把充值表和账单表各拉 page*pageSize 行进内存合并排序。
  - 影响:管理端 /api/admin/orders 传大 page 触发近全表载入+JS 排序。
  - 修复建议:给 page 设上限或改游标/双指针合并分页。

- [M04-09] P3 | 置信度 高 | server/src/routes/orders.ts:714-731
  - 问题:订单运营退款登记不校验充值订单状态,上限用请求 amount 而非实际入账 actualAmount;"已有 pending 退款"查重是 check-then-create 并发可重复。
  - 修复建议:限定仅 completed/refunded 可登记退款、上限取 actualAmount,pending 退款加条件唯一性。

- [M04-10] P3 | 置信度 高 | server/src/services/billing-scheduler.ts:162-195
  - 问题:自动续费余额预检用原价,实际扣款 performRenewal 是 AFF 折后价。
  - 影响:绑定优惠码用户余额介于折后价与原价之间时自动续费被误判失败(3次后关自动续费),实例可能因此到期封停。
  - 修复建议:预检与实际扣款统一按折后价,或去掉预检只依赖条件扣款。

- [M04-11] P3 | 置信度 中 | server/src/db/billing-operations.ts:352-357, 666-668
  - 问题:过期后续费 newExpiresAt 从当前时间起算,但账单 periodStart 记为旧 expiresAt(过去),账期长度大于实际付费天数。
  - 影响:单位时间价值被稀释,之后按剩余价值退款用户少退,账期数据失真。
  - 修复建议:periodStart 与 baseDate 同源。

- [M04-12] P3 | 置信度 高 | server/src/routes/orders.ts:473-486(对照 OrdersView.vue:119、admin/OrdersView.vue:261)
  - 问题:前后端契约不齐,两端订单页渲染 order.instance.displayName || name,但后端 instance select 只返回 id/name/packagePlan,从不返回 displayName。
  - 影响:用户设置的实例显示名在订单中心永远不生效。
  - 修复建议:后端 select 补 displayName 或前端删该字段依赖。

- [M04-13] P3 | 置信度 中 | server/src/db/billing-operations.ts:870-892, 941-953
  - 问题:performPlanChange 降级分支把退款计入余额(type:'refund'),但账单记 type:'downgrade', amount:0,该退款不被 getMaxRefundable 的"已退金额"扣减。
  - 影响:当前降级被封死此分支不可达;一旦放开降级可"降级拿退款→再按未扣减 maxRefundable 全额退款"双重套取。埋雷型账务不对称。
  - 修复建议:降级账单记 type:'refund'/负金额,或删不可达分支。
