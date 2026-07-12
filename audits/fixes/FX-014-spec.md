# FX-014 规格：Hosting 回扣不足时平台默默兜底(E18 / BF-10-04)

## owner 裁决(BEHAVIOR.md E18)
回扣不足(节点主人提现花光后遇买家退款)时,不让平台默默吃差额,应把节点主人余额扣成负数记欠款。

## 根因
deductHostingBalance(server/src/db/billing-operations.ts:1399-1567)三级回扣(冻结→托管余额→面板余额)每级 Math.min(可用,待扣),
扣不满也不报错,totalDeducted 可能 < 应扣 → 平台默默吃差额。

## 修法（只改 server/src/db/billing-operations.ts 的 deductHostingBalance;不碰 package.json、尽量不改 schema)
1. 先只读通读 deductHostingBalance 三级回扣逻辑与 hostingBalance 字段。
2. 三级(冻结/已解冻托管余额/面板余额)按现有优先级尽量扣;若扣完仍有**缺口 shortfall = 应扣 − totalDeducted > 0**:
   把该 shortfall **记为节点主人的欠款**——即把节点主人的**托管可用余额(hostingBalance)扣成负数**(记一条 type:'deduction'/或调整 的 hostingBalanceLog,金额为负,remark 注明"回扣缺口记欠款"),使 totalDeducted = 应扣全额、平台不吃差额。
   - 允许 hostingBalance 转负(这是 owner E18 明确要的"记欠款");若现有代码/约束禁止负 hostingBalance,放开该路径的非负限制(仅对本欠款场景),并在交付说明。
   - 欠款为负余额后,后续该节点主人有新收入解冻/入账时会自然抵扣欠款(确认现有入账是 increment,不会因负余额异常)。
3. 不改其它调用方(FX-011/FX-015 调 deductHostingBalance 的口径不变,只是它内部现在会把缺口记欠款)。

## 加守卫
在现有 server/scripts/test-hosting-balance-guards.ts 追加断言:deductHostingBalance 扣不满时把缺口记为节点主人负余额欠款(不静默吞差额)。不改 package.json。

## 验收
- pnpm --filter server type-check 通过;pnpm --filter server test:hosting-balance-guards、test:financial-reconciliation-guards 通过。

## 交付
一段话:缺口如何记欠款、是否放开负余额限制及范围、后续入账抵扣是否正常、守卫结果。不要 commit。
