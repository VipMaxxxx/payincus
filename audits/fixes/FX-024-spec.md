# FX-024 规格：套餐收入单位放大 100 倍(P1 / D-048 / M24-01)

## 根因
server/src/routes/admin-capacity-cost.ts:415 附近的容量/成本模型把套餐价格当"元"算月收入/毛利,
但套餐价格 plan.price 实际以"分"存储(与全站一致:plan.price=分、instance.billingPrice=元)→ 收入放大 100 倍,
低毛利/亏损套餐被显示成高毛利、亏损预警失效。相关取数在 db/package-plans.ts:359。

## 修法（改 server/src/routes/admin-capacity-cost.ts,必要时 db/package-plans.ts;不碰 package.json）
1. 先只读通读 admin-capacity-cost.ts:415 附近 + db/package-plans.ts:359,确认价格字段进入收入/毛利计算时的单位。
2. 在进入容量成本/收入模型**之前**,把套餐价从"分"统一转"元"(/100)。**务必只转一次**——若数据流中某处已 /100,不要再除;以"最终参与收入/毛利的数值是元"为准。用清晰的中间变量(如 priceYuan)避免混淆。
3. 若 db/package-plans.ts:359 是收入聚合的取数点且更适合在那里统一口径,可在此转换,但保证全链只转一次、且不影响其它以"分"为单位的正确用途(如展示价格、下单扣费——这些若也用同一函数,勿误改)。优先在 capacity-cost 模型入口转换,风险最小。

## 加守卫
在现有 server/scripts/test-capacity-cost-guards.ts 追加断言:收入/毛利计算路径包含"分转元"(/100 或等价)的换算,钉死跨单位口径。不改 package.json。

## 不许动
- 不改下单扣费、账单、展示价格等其它用途的单位。不做大重构。

## 验收
- pnpm --filter server type-check 通过;pnpm --filter server test:capacity-cost-guards 通过;
- pnpm --filter server test:commercial-operations-overview-guards 通过(确认未误伤运营台其它口径)。

## 交付
一段话:换算加在哪一步、如何确保只转一次、守卫结果。不要 commit。
