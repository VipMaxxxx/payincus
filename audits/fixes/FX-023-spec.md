# FX-023 规格：到期删除窗口内仍可续费/status='deleted' 实例可被续费改配(P2 / M04-02)

## 根因
到期删除"认领→Incus删除窗口→DB(现已软删 status='deleted',见 FX-025)"期间,用户仍可成功续费;
续费路由与 performRenewal 只拦 suspended,不拦 status='deleted' → 已软删/删除中的实例被续费,钱扣了实例却删/删着。

## 修法（改续费/改配入口:server/src/routes/instance-billing.ts + server/src/db/billing-operations.ts performRenewal/performPlanChange;不碰 package.json)
1. 先只读通读续费路由(instance-billing.ts)与 performRenewal / performPlanChange(billing-operations.ts):现有对实例状态的拦截(suspended 等)。
2. 显式拒绝 **status='deleted'** 的实例:续费与改配入口在扣款前检查 instance.status !== 'deleted'(deleted → 返回明确 400/409"实例已删除,无法续费/改配"),并在 performRenewal/performPlanChange 的条件更新 where 里也带上 status 条件(与 version 一起),防窗口内竞态。
3. 不改到期删除逻辑本身(FX-025 已改软删)。

## 加守卫
在现有 server/scripts/test-instance-billing-route-id-guards.ts 或 billing 相关守卫追加断言:续费/改配拒绝 status='deleted'。不改 package.json。

## 验收
- pnpm --filter server type-check 通过;pnpm --filter server test:instance-billing-route-id-guards、test:billing-expiry-race-guards 通过。

## 交付
一段话:在哪几处加了 deleted 拦截、条件更新如何带 status、守卫结果。不要 commit。
