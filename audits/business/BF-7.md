# BF-7 兑换市场与转账 · 业务行为说明书 + 疑点清单

## 一、现状行为

### A. 用户间转账/转移(Transfer)
- **手续费**:读 transfer_fee(**固定金额/元,默认 0**,非比例),发起方发起时从主余额扣(`transfers.ts:249-291`;`db/transfers.ts:126-178` type='transfer_fee')。
- **去向**:转账成功接受后手续费归平台,写 instanceBillingRecord type='transfer_fee'(`db/transfers.ts:596-609`)。
- **退款**:拒绝/取消时退还手续费到发起方(transfer_refund)。
- **过户动作**:executeTransfer 仅改 userId/name/incusId/displayOrder,**不动 expiresAt/billingPrice/autoRenew,不建 newPurchase**(`db/transfers.ts:557-611`);过户后删除反代/端口/快照/备份/策略;**不重装系统**——磁盘数据与 root 凭证原样保留给接收方。
- 并发:pending→processing(乐观锁)→accepted;processing 30 分钟回滚;转账与交易所互斥(checkExchangeLock)。

### B. 兑换市场(Exchange)
- **挂牌**:卖家先停机→挂牌,不收费不冻结。溢价上限 assertMaxMarkup:price ≤ billingPrice×maxMarkupPercent/100,但 **billingPrice 为0/空或 maxMarkupPercent 为0 时整段跳过**(`exchange.ts:302-313`)。每人最大挂牌数限制。
- **手续费**:calculateFee=price×feePercent%,按 minFee/maxFee 夹逼;**买家付全价,卖家到手 price−fee,差额平台留存**。费率挂牌时算好存 listing,下单拷到 order。
- **托管资金流**:买家下单即从主余额扣 price(exchange_purchase);exchangeWallet 的 escrow_hold 是纯信息(前后额相等);放款时卖家 available += sellerReceivesAmount,手续费不入任何钱包;退款时 escrowAmount 全额退买家主余额。**闭环成立**:出=卖家到手+平台抽成=price。
- **交割过户**:托管→冻结卖家访问→清理 SSH/终端/端口/快照/备份/风控→**强制重装(rebuild)**→改 incusId+改名+转 owner→建买家 newPurchase 计费、autoRenew=false、**保留流量占用**、expiresAt 不变→订单进 confirming、listing 置 sold。
- **结算/退款/争议**:
  - 结算:仅 autoConfirmEnabled 时对到期 confirming 单自动放款;**无买家"确认收货/提前放款"接口**;否则等自动确认或管理员人工放款。
  - 退款:先把已交割实例退回卖家(改回名、停机、保留流量)再退买家全款、挂 force_delisted。
  - 争议:仅 delivered/confirming/disputed/manual_review 可发起;争议"冻结"只是标记日志(前后额相等);超时转人工。
  - 买家风控闸:未结争议、7天内争议≥3、取消/退款≥3 则禁购。
- **提现**:最低额、每日次数/金额限、冻结→人工审核→完成/拒绝;有未结算交易或未完结争议不能提现。

---

## 二、业务疑点清单

- **[BF-7-01] 资金/退款缺口 | transfers.ts:505-509,964-968 + db/transfers.ts:544-552** — 接受/推送时若实例已删,走 cancelTransfer 只改 cancelled **不退手续费**;交割完成把该实例 pending 转账批量 cancel 也不退。发起方付了 transfer_fee,实例待接收期被删/被卖,**手续费打水漂**,与"拒绝时退还"文案不符。需确认:**系统自动取消(非对方拒绝)的转账是否也必须退还手续费?**
- **[BF-7-02] 费率规则 | system-config.ts:122、transfers.ts:249** — 转账费固定金额、只发起方承担、成功归平台;与交易所比例模型不同,固定额对高价值实例几乎无成本、对低价值偏重。需确认:**维持"固定额/发起方全承担/成功不退"是期望设计吗?**
- **[BF-7-03] 功能达成/经济闭环 | billing-scheduler.ts:143-147 vs :361-522** — 挂牌实例被交易所锁→自动续费跳过;但**到期封停与到期删除均不检查交易所锁**,挂牌可不设 autoDelistAt(永久挂)。长期挂市场的实例既不能自动续费又照常到期→封停→3天后**被删**,listing 可能仍 active(僵尸挂牌)。需确认:**挂牌中实例到期应"自动下架并允许续费/暂缓删除",而非直接封停删除?**
- **[BF-7-04] 定价/套利 | exchange.ts:302-313** — 溢价上限锚定单周期价 billingPrice;billingPrice 为0/空(赠送/抽奖/0元秒杀获得)时**完全不设上限**,只受全局 maxPrice。低价/免费实例可高价挂卖套利。需确认:**billingPrice 为0/空的实例是否应禁止挂牌或强制独立上限?**
- **[BF-7-05] 功能达成 | routes/exchange.ts(无 confirm 端点) + exchangeDeliveryWorker.ts:608-637** — **买家没有"确认收货/立即放款"入口**;放款只有自动确认到点或管理员逐单人工。卖家资金压满整个确认期;关自动确认时人工负担=全部订单。需确认:**是否新增买家主动"确认收货即放款"?**
- **[BF-7-06] 套利/风控 | admin-exchange.ts:399-459 + exchange.ts:445-487** — 退款把已交割实例退回卖家并**保留流量占用**;买家在确认/争议窗口高强度用机后再退款,拿回全款而资源消耗留给卖家(有 7天≥3 闸门缓解)。需确认:**退款是否应对买家持有期消耗做补偿/计入卖家可保留款?**
- **[BF-7-07] 归属迁移一致性 | db/transfers.ts:557-611** — 普通转账不重装、不重置 autoRenew、不重建计费,接收方继承发起方自动续费开关、计费价与磁盘既有凭证;交易所交割强制重装且 autoRenew=false。两条换主人路径安全/计费模型不一致。需确认:**普通转账过户是否也应默认关 autoRenew 并提示重置凭证,与交易所统一?**
- **[BF-7-08] 状态机死状态 | exchange.ts:19-21** — 订单 escrowed/delivered、挂牌 paused、争议 redelivering 在阻断集合被引用但**全流程从不写入**(下单直进 delivering,交割完成直进 confirming)。属死状态,admin overview 里 delivered 计数恒0。需确认:**保留占位还是清理?**
- **[BF-7-09] 收入核算 | exchange.ts:1685-1700** — 交易所平台抽成不落 instanceBillingRecord,只在 exchangeWalletLog 以 fee_charge 留痕(钱包前后额不变);收入统计仅含 newPurchase/renew/upgrade/transfer_fee。**交易所抽成可能未计入官方收入报表**。需确认:**交易所手续费是否单列进收入台账/统计?**

---

## 三、给 owner 的 TOP5 必答确认问题
1. **[BF-7-03]** 挂牌中实例到期照常封停并3天后删除(续费被跳过、封停删除不看交易所锁)——**是否应到期自动下架/暂缓删除,避免删掉正在售卖的实例?**
2. **[BF-7-01]** 实例待接收期被系统删/被卖导致转账自动取消时,发起方手续费**不退**——**这种"非对方拒绝"的取消是否也应退费?**
3. **[BF-7-04]** billingPrice 为0/空的实例(赠送/抽奖/0元)挂牌时**溢价上限被整段跳过**可高价套现——**是否禁止挂牌或强制独立上限?**
4. **[BF-7-05]** 交易所**无买家"确认收货即放款"入口**,卖家资金压满确认期,关自动确认时全靠人工逐单放款——**是否新增买家主动确认放款?**
5. **[BF-7-02]** 转账费固定额、发起方全承担、成功不退,与交易所比例抽成不一致——**这套转账费率是否即期望设计?**

其余 BF-7-06/07/08/09 已列清单,均有代码证据。全程只读,未改动任何文件。
