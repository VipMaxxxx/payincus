# 交易所批:BF-7-05 买家确认收货即放款 + BF-7-08 死状态清理(F-D 全同意)

## 两条裁决
- **BF-7-05**:新增买家主动"**确认收货即放款**"(现只有 autoConfirmEnabled 到点或管理员逐单,卖家资金压满确认期)。证据:routes/exchange.ts(无 confirm 端点)、exchangeDeliveryWorker.ts:608-637。
- **BF-7-08**:交易所**死状态**(escrowed/delivered/paused/redelivering)被阻断集合引用但全流程从不写入,delivered 计数恒0 → **清理**。证据:exchange.ts:19-21。

## 修法(只改 routes/exchange.ts + 必要 db/worker + 守卫;不改 schema 枚举列/不迁移;不碰 ai-ticket-context(并行))
1. **BF-7-05 确认收货端点**:新增买家 `POST /exchange/:id/confirm`(或等价),校验调用者=买家 + 订单处于可确认态(已交付/确认期内),**立即放款给卖家**(复用 exchangeDeliveryWorker:608-637 的放款逻辑),幂等(重复确认不重复放款),写审计。autoConfirm 到点逻辑保留作兜底。
2. **BF-7-08 死状态清理**:
   - 若 escrowed/delivered/paused/redelivering 全流程从不写入且仅被阻断集合引用 → 从**代码层**的阻断集合/状态机引用中移除(或标注 deprecated),修正 admin overview 的 delivered 计数(要么正确统计要么移除该恒0项)。
   - **枚举定义保留**(避免 DB 存量/迁移),仅清理死引用与误导统计。
3. 与既有交易所交割/退款(FX-031)、风控受让(FX-067b)协同,不回退。

## 加守卫
`test:exchange-marketplace-guards`/`test:exchange-lifecycle-guards` 追加:买家确认放款幂等、死状态不再被活流程引用/delivered 统计修正。不改 package.json。

## 不许动
不碰 ai-ticket-context(并行)。不回退 FX-031/067b。不改 schema 枚举/不迁移。不 commit。

## 验收
type-check 通过;`test:exchange-marketplace-guards`、`test:exchange-lifecycle-guards`、`test:financial-reconciliation-guards` 通过。交付一段话:确认端点/幂等放款、死状态怎么清、守卫结果。
