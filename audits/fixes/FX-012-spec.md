# FX-012 规格：退款不按比例冲回 AFF 佣金(E5② / BF-3-02)

## owner 裁决(BEHAVIOR.md E5②)
退款按比例冲回 AFF 佣金及统计。

## 根因
返利下单即时入账且可即时变现;买家随后主动销毁(首次免手续费、近全额退)时返利**不追回**(instance-destroy 无 aff 冲正)。
对比:交付失败自动退款**会**冲正返利(server/src/db/instance-provisioning-compensation.ts:110-166:扣回码主 AFF 余额 + 回滚 affCode 统计)——已有现成参照。

## 修法（改 server/src/routes/instance-destroy.ts 与 server/src/routes/admin-billing.ts 退款路径,复用现有 aff 冲正)
1. 先只读 instance-provisioning-compensation.ts:110-166 的 aff 佣金冲正做法(如何扣回码主 AFF 余额、如何回滚 affCode 的 totalCommission/统计),以及绑定的 affBinding 如何查。
2. 用户自助销毁(instance-destroy.ts)按**退款比例**冲回该实例已发的 AFF 佣金:
   - 冲回金额 = 该实例已发佣金 × (本次退款额 / 原实付) 的比例(或按剩余价值比例,取与"返利基数"一致的口径);先只读确认原佣金是按什么基数发的(BF-5:按下单原价 billing.price),据此定比例。
   - 复用现成的冲正函数/逻辑(扣码主 AFF 余额 + 回滚 affCode 统计),在退款同一事务内完成。
3. 管理员退款(admin-billing.ts 退款/删除并退款)同理按比例冲回。
4. 边界:码主 AFF 余额已变现花光时的处理——与 E18 一致的思路(可记欠款/扣成负),或至少不静默吞;先只读看现成冲正函数怎么处理不足,复用其口径,不在本条重造。

## 加守卫
在现有 server/scripts/test-aff-review-ui-guards.ts 或 aff/退款相关守卫追加断言:用户销毁/管理员退款按比例冲回 AFF 佣金。不改 package.json。

## 不许动
- 不改交付失败自动退款(它已冲正);不改 billing-operations.ts 的 deductHostingBalance(FX-014 并行)。不改佣金比例。不做大重构。

## 验收
- pnpm --filter server type-check 通过;pnpm --filter server test:aff-review-ui-guards、test:user-destroy-incus-order、test:financial-reconciliation-guards 通过。

## 交付
一段话:复用了哪个冲正逻辑、比例口径、不足如何处理、加在哪几条退款路径、守卫结果。不要 commit。
