# FX-025 规格：到期删除硬删实例级联抹掉账单(P1 / D-004 / M04-01)

## 根因
server/src/services/billing-scheduler.ts(约 463-583,删除段 ~520)到期删除任务对实例执行**硬删** prisma.instance.delete;
InstanceBillingRecord.instance = onDelete:Cascade → 该实例全部消费/退款账单随之永久删除。
而用户自助销毁(instance-destroy.ts:193)、管理员删除退款都只是置 status='deleted' **软删**——仅此路径硬删,导致订单中心丢单、收入统计随时间倒缩水、对账断链。

## 修法（只改 server/src/services/billing-scheduler.ts 到期删除段;不碰 package.json、不碰 schema)
1. 先只读对照:instance-destroy.ts 用户销毁路径如何"软删"(status='deleted' 具体设了哪些字段:status/deletedAt/suspend* 等)、以及删除 Incus 实例 + 回滚宿主机资源 + 释放 IP/端口的调用。
2. 把到期删除的 `prisma.instance.delete(...)` 改为**软删**(status='deleted' + 与用户销毁路径一致的字段),**保留** InstanceBillingRecord/账单;
   - **务必保留**原有的:删除 Incus 实例、回滚宿主机资源(cpu/mem/disk)、释放 IP/端口、托管收入回扣等副作用——只把"DB 硬删"换成"DB 软删",其余交付/回收动作不变。
   - 用带条件的 updateMany(where 含当前 status/version,避免与并发续费竞态,参照 BF-1-02 系列)原子改状态。
3. 确认软删后:这些实例不再出现在用户"我的实例"列表(前端/查询已按 status!='deleted' 过滤——先只读确认;若未过滤则说明,不在本条改前端)。收入统计不再因删除倒缩水。

## 加守卫
在现有 server/scripts/test-billing-expiry-delete.ts(或 billing-expiry-race-guards)追加断言:到期删除为软删(status='deleted')、不 prisma.instance.delete、保留账单。不改 package.json。

## 不许动
- 不改 schema 的 Cascade(那需迁移,风险大;软删即可规避)。不改用户销毁/管理员删除路径。不做大重构。

## 验收
- pnpm --filter server type-check 通过;pnpm --filter server test:billing-expiry-delete、test:billing-expiry-race-guards、test:instance-billing-route-id-guards 通过。

## 交付
一段话:软删设了哪些字段、保留了哪些交付/回收副作用、与并发续费的竞态如何避、守卫结果。不要 commit。
