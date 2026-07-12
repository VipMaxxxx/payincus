# 波4 设计文档:插件/主题交易闭环(BF-12-01/02 完整版)—— 待 owner 决策 + 需 schema

## 背景与裁决
- **BF-12-01/02 本期裁决(已实现)**:插件/主题**一律按免费处理、禁止上架 paid 条目**,直到交易/授权/退款/分成/结算闭环上线(见 EXECUTION_LOG「BF-12-01/02」✅ + 治理批 BF-12-03/04/05/06/08 ✅)。
- **完整闭环 = 本波4 大功能**:购买 → 授权 → 退款 → 开发者分成 → 平台结算。现**数据模型完全没有**购买/授权/分账/结算表。

## 为何不擅自实现
- 需**新增多张 schema 表 + 迁移**(违"自主批次不擅改 schema/不迁移"红线,与 FX-046/065全元 并列);且涉及**真实资金分账/结算/开发者收入**——高危、需 owner 明确产品规则。

## 建议设计(需 owner 批准后再做 schema)
### 新增数据模型(草案)
- `PluginPurchase`(购买单:userId, pluginId, version, priceCents, currency, status, tradeNo, createdAt)。
- `PluginLicense`(授权:userId, pluginId, grantedAt, expiresAt|永久, source=purchase/gift, revokedAt)。
- `PluginRefund`(退款:purchaseId, amount, reason, status, createdAt)——复用 recharge-refund 模式。
- `PluginDeveloperEarning`(开发者收入:developerId, pluginId, purchaseId, grossCents, platformFeeCents, netCents, settledAt)。
- `PluginSettlement`(结算批次:developerId, periodStart/End, totalNetCents, status, paidAt)。
### 关键规则(需 owner 定)
1. **平台抽成口径**:固定百分比?最小货币单位整数?币种白名单?(呼应 BF-12-09)。
2. **授权模型**:一次性买断永久?订阅制?按版本?升级是否重新付费?
3. **退款政策**:退款窗口?退款是否吊销授权+冲回开发者收入(复用 FX-012 冲回思路)?
4. **结算周期与最低结算额**;开发者提现(复用 Hosting 出金人工审核 BF-10-03 模式)。
5. **定价校验**:BF-12-09"最小货币单位整数+币种白名单+固定平台抽成+拒绝不完整 paid"。
### 复用既有闭环资产
- 支付走既有充值/网关(epay/heleket/antom);退款复用 recharge-refund;安全外呼 FX-003/056;审计中心 Log;授权校验接入插件运行时 `isPluginEnabled`/capability 门禁。
- 上架门禁:闭环上线后**放开 paid 上架**(解除 BF-12-01/02 的 free-only 限制),但仍要 BF-12-03/04/05/06/08 治理。

## owner 决策点(需回答后再实现)
1. 批准新增上述 schema 表 + 迁移?
2. 抽成口径/币种白名单/最小单位?
3. 授权模型(买断/订阅/按版本)?
4. 退款政策(窗口/吊销/冲回)?
5. 结算周期/最低额/开发者提现方式?

## 实现工作量(owner 定后)
- schema + 迁移 + 购买/授权/退款/分账/结算全链路 + 支付集成 + 授权运行时校验 + 开发者后台 + 大量守卫。**大功能,需分阶段 + 真机 + 灰度**。

**状态:⏸ 待 owner 批准 schema + 定产品规则,再进入实现。当前 BF-12-01/02 已用 free-only 门禁安全兜住。**
