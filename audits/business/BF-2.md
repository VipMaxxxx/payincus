# BF-2 订单与支付 · 业务行为说明书 + 疑点清单

## 一、现状行为(代码实际怎么跑)

### 1. 下单与手续费/应付/到账三额口径
- 前端 WalletView 三额与后端算法对齐(`WalletView.vue:701-720`)。
- 后端下单 `POST /api/recharge/orders`(`recharge.ts:1293`):fee=calculatePaymentFee、payableAmount=calculatePayableAmount、actualAmount=calculateActualAmount(`1353-1356`)。
- **手续费两种模式,只按渠道类型区分**(`payment-providers.ts:506-548`):
  - `isSurchargeFeeProvider` 只对 **yipay** 为 true → 加收:应付=金额+手续费,到账=全额。
  - **heleket/antom/manual/plugin_gateway** 一律 **扣费**:应付=金额,到账=金额−手续费。
- 到账额<=0 的订单被拒(`recharge.ts:1357-1363`)。金额范围只校验名义额,minAmount 默认1、必须>0,maxAmount 可空。
- **methodFees(支付方式级手续费)只对 yipay 生效**(`payment-providers.ts:488-504`)。

### 2. 跳转支付/回调/主动验单
- 按渠道生成支付链接(`recharge.ts:908-993`);manual 无链接只展示付款说明。
- 回调(`recharge.ts:3379-3941`):验签→IP白名单→订单号/渠道一致→金额匹配(heleket 允许超付只拒不足;其余精确匹配;antom 校验币种+最小单位)→completeRecharge。
- **入账额固定用 creditedAmount = record.actualAmount ?? amount**(扣费后到账额),回调 paidActualAmount 只用于比对不改入账额。
- 回调/验单已不因本地过期而丢弃(验签验额通过即入账),配合调度器 6 小时宽限期。

### 3. 到账入余额
- `completeRecharge`(`recharge-records.ts:403-534`):状态机条件更新 status IN(pending,paid)→completed,原子幂等;事务内 advisory lock、balance += creditAmount、写 balanceLog(type=recharge)。
- balanceLog remark 用名义额"充值:${amount} 元",而 amount 字段是真实入账额。

### 4. 订单状态机 / repay
- 状态集 pending/paid/completed/failed/cancelled/refunded。迁移守卫处处允许 pending 或 paid,但**全库从不写 paid**——订单只 pending→completed/failed/cancelled/refunded。
- repay 只允许 pending、未过期,可换支付方式重算 fee/actual,为同一订单号重新生成支付链接。
- cancel 只允许 pending;过期订单在过期+6h 后 pending→cancelled。

### 5. 退款登记(两条并存路径)
- **A. 插件网关原路退款**(`admin-billing.ts:3904`→`recharge-records.ts:681-824`):仅 plugin_gateway;内置渠道被拒。上限=到账额;进入处理先**预扣**用户余额(decrement),失败返还。
- **B. 订单中心退款审批**(`orders.ts:680-796`→`balance.ts:357-417`):对充值/账单通用;上限=**名义 order.amount**;requestType 硬编码 refund、金额恒正→审批通过 changeBalance(+amount) **给用户加余额**。文档指定内置渠道退款走此路径。

### 6. 对账
- `POST /admin/billing/reconciliation/run`:业务层对账口径与入账口径一致(金额取 actualAmount??amount),**健康**。

---

## 二、业务疑点清单

- **[BF-2-01] 规则可疑 | payment-providers.ts:506-548、recharge.ts:1382** — 仅 yipay 加收手续费,heleket/antom/manual/plugin 一律从到账额扣。跨渠道"充100"到账不一致。需确认:非易支付渠道"扣到账"口径是否有意?
- **[BF-2-02] 功能残缺 | payment-providers.ts:488-504** — methodFees 只对 yipay 生效,其它渠道即使配了也忽略。需确认:是否符合预期?
- **[BF-2-03] 功能残缺/UX | recharge.ts:1357-1363** — 扣费渠道若 feeFixed≥金额,小额充值先过 min 校验再被"到账<=0"拒,报错含糊。需确认:是否按"扣费后到账≥下限"约束最小充值额?
- **[BF-2-04] 内部矛盾(死状态) | recharge-records.ts:92-99,443** — paid 状态被定义且作为合法前置,但全库从不写入;前端还把 paid 当完成态统计。需确认:补齐 paid 语义还是移除?
- **[BF-2-05] 经济倒挂 | recharge.ts:1604-1784** — repay 重新生成支付链接但不作废旧单;用户用两个链接各付一次,网关收两笔、平台只入账一次→重复扣款。需确认:是否作废旧单/同订单仅一个有效支付单?
- **[BF-2-06] 功能残缺 | billing-scheduler.ts:728 + recharge.ts:3038,3801** — 过期+6h 置 cancelled 后,迟到的真实到账无法自动/一键入账。需确认:6h 宽限够吗?超时到账要不要正式重激活入口?
- **[BF-2-07] 功能残缺(已文档化) | admin-billing.ts:587-610** — 自动原路退款只支持 plugin_gateway;易支付/antom/heleket/manual 无原路退款。需确认:内置渠道长期不做原路退款、靠加余额兜底是既定策略吗?
- **[BF-2-08] 内部矛盾/经济倒挂(核心) | orders.ts:714,743 + balance.ts:389-401 vs recharge-records.ts:698-783** — 两条充值退款方向相反:插件原路退款**扣**用户余额(上限到账额),订单中心审批**加**用户余额(上限名义额)。对已入账充值,唯一可用退款是再给用户加余额→若同时线下原路退真钱则双倍补偿。需确认:退已入账充值,余额应扣减还是增加?
- **[BF-2-09] 经济倒挂 | orders.ts:714** — 退款上限用名义 order.amount 而非到账 actualAmount,扣费渠道可退超实收。需确认:上限改为 actualAmount?
- **[BF-2-10] 规则可疑 | orders.ts:697-716** — 订单中心对 recharge 退款不校验是否 completed/已入账,可对 pending/failed/cancelled 登记退款审批。需确认:限"仅 completed 且已入账"?
- **[BF-2-11] 规则可疑 | recharge-records.ts:762-783** — 插件原路退款进入处理前预扣当前余额,余额不足即抛错;用户充完花光则合法退款被阻断。需确认:允许转负还是维持现状?
- **[BF-2-12] 文档-代码轻微不符 | recharge-records.ts:495** — 入账 remark 写名义额,amount 字段是到账额,扣费渠道备注与真实到账对不上。需确认:remark 改显真实到账额?

---

## 三、给 owner 的 TOP5 必答确认问题
1. **[BF-2-08] 充值退款的余额方向**:退"已入账的充值",订单中心审批当前是给用户**再加余额**,插件原路退款是**扣余额**——同一业务方向相反,应当收回(扣减)还是发放(增加)?
2. **[BF-2-01] 手续费口径**:除易支付(加收)外,heleket/antom/manual/plugin 一律从到账额扣手续费,是有意的吗?
3. **[BF-2-05] repay 重复付款**:重新支付不作废旧单,用户可能被网关重复扣款而只入账一次——要不要"同订单仅一个有效支付单/作废旧单"?
4. **[BF-2-07] 内置渠道无原路退款**:自动原路退款只支持插件网关,主力渠道全靠"加余额审批"兜底——既定策略还是要补真原路退款?
5. **[BF-2-11] 原路退款预扣余额**:退款要求用户当前余额足够否则被阻断,用户花光余额时的合法退款该允许转负还是维持?
