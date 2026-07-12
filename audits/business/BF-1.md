# BF-1 计费生命周期 · 业务行为说明书 + 疑点清单

## 一、现状行为(代码实际怎么跑)

### 0. 计费口径的"标准"是什么
- 全站"标准日历"定义在 `server/src/lib/billing-calc.ts:17-22`:**1 个月 = 31 天**(月付31、季付93、半年186、年付372)。
- 日价 = 周期价 / 周期天数(31基)`billing-calc.ts:41-44`;到期时间 = `addMonths()` = 基准日 + `月数×31天` `billing-calc.ts:309-314`。
- 数据库里套餐 `plan.price` 存**分**,实例 `instance.billingPrice` 存**元**(`billing-operations.ts:119-124`、`420`)。

### 1. 开通(新购)
- `instances.ts:1412` 调 `calculateCreateBilling` → `expiresAt = 现在 + billingCycle×31天`。
- 付费扣款:`actualPrice`=(秒杀价或原价)−优惠码折扣 `instances.ts:1413-1431`;扣余额 `1757-1763`。
- 落库:`instance.billingPrice = 套餐原价(plan.price/100)` `instances.ts:1859` —— **注意:秒杀/优惠码买家这里存的是"名义原价",不是实付价**。
- 账单记录 `type:newPurchase, amount:actualPrice(实付), periodStart:now, periodEnd:expiresAt` `instances.ts:1876-1893`。
- 托管节点(节点主人是普通 user):按 `actualPrice` 全额记一笔冻结30天的托管收入 `instances.ts:1938-1944` / `billing-operations.ts:1338-1376`。

### 2. 续费(手动/自动)
- 金额 = 月价×月数,月价 = `billingPrice / billingCycle`(即按名义原价折算,`billing-operations.ts:139-143, 348-349`)。有优惠码则再打折 `performRenewal` `538-572`。
- 新到期:未过期从 `expiresAt` 顺延,已过期从 `now` 顺延,均 `+月数×31天` `billing-operations.ts:351-357`。
- 续费成功会把到期封停的实例解封为 `stopped`、`autoRenewAttempts` 归零 `billing-operations.ts:626-635`。
- 账单 `type:renew, periodStart:instance.expiresAt(旧到期,可能是过去时间), periodEnd:newExpiresAt` `billing-operations.ts:660-674`。
- **自动续费调度**(`billing-scheduler.ts`):到期前**24h**触发(每小时:00 跑),按 `billingCycle` 月数续费,最多 **3 次**尝试,超限则关闭 autoRenew;余额不足/失败发站内信+邮件 `40-41, 99, 150-157, 161-162, 786`。
- 用户手动续费:托管实例**仅限1个月**且**仅到期前7天内** `instance-billing.ts:631-652`;`billing-operations.ts:1045`。

### 3. 升级/降级
- 用户端**只允许升级、禁止降级**(preview 与 execute 双重拦截)`instance-billing.ts:873-876, 1004-1013`。
- 差价 = 新方案费用 − 剩余价值,两者都 = `日价(31基) × 剩余天数`,基于 `instance.billingPrice` 名义价 `billing-calc.ts:231-275`、`billing-operations.ts:420-431`。
- 升级门槛:剩余天数 **< 15 天不能升级** `billing-operations.ts:396, 407-410`。
- 升级到期时间**不变**,只补差价 `billing-operations.ts:445`;差价>0 扣款、<0 退款(降级逻辑存在但用户端够不到)`billing-operations.ts:813-892`。

### 4. 到期 → 封停 → 删除
- **封停**:每 30 分钟扫一次,`expiresAt < now` 即封停(付费实例)`billing-scheduler.ts:791`、`instance-suspend.ts:188-199`。**到期与封停之间无宽限期,30 分钟内停机**。
- **删除**:封停满 **3 天**(`SUSPEND_AFTER_DELETE_DAYS=3`)、且 `suspendReason='expired'`,每天 03:00 删除并回滚资源、级联删库 `billing-scheduler.ts:42, 440-443, 463-583`。
- **到期提醒**:仅到期前 **3 天**提醒一次,且**只发给 autoRenew=false 的实例** `billing-scheduler.ts:43, 623`、`610-637`。autoRenew=true 的实例不发提醒(靠自动续费兜底,失败才发 auto_renew_failed)。
- 状态机:`active/running/stopped → (到期) suspended(expired) → (3天) deleted`;续费或管理员延期可从 expired-suspended 回到 `stopped`。

### 5. 退款(三条路径)
- **A. 用户自助销毁退款** `instance-destroy.ts`:
  - 剩余价值按**账单记录时间比例**逐条算(安全口径,capped at maxRefundable)`billing-operations.ts:210-307`。
  - 手续费:**首次销毁免,第2次起 10%**,`destroyCount` 是**按用户全局**计数(非按实例)`instance-destroy.ts:119-122, 260-268`。
  - 退款 = 剩余价值 − 手续费;`error` 状态实例免手续费 `instance-destroy.ts:266-268`。
  - 托管实例:从**节点主人**余额回扣 `refundAmount` `instance-destroy.ts:312-318`。
  - 限制:非到期实例本月已用流量 ≥ 5GiB 不能销毁 `instance-destroy.ts:25-28, 124-126`。
- **B. 管理员退款 / 删除并退款** `admin-billing.ts:2546-2672, 2677-2943`:
  - 手动退款:金额 ≤ `maxRefundable`(=历史消费−历史已退)。
  - 删除并退款:`remaining`=按剩余价值,`full`=**全额退所有已消费**(可退超过剩余价值)`admin-billing.ts:2735-2746`。
  - **均不回扣托管节点主人余额**(无 `deductHostingBalance`)。
- **C. 降级差价退款 / 管理员改价退款**:改价按名义价差价结算 `admin-billing.ts:3140-3243`(单个)、`3377-3523`(批量)。
- **D. 管理员延期** `admin-billing.ts:2344-2541`:按 `days×24h` 加到期时间,费用 = **`日价(月价/30)` × days** `admin-billing.ts:796-799, 2384-2385`。

---

## 二、业务疑点清单

- **[BF-1-01] 内部矛盾/经济倒挂 | admin-billing.ts:796-799, 2384-2385(对比 billing-calc.ts:17-33)**
  - 现状:管理员"延期"用本地 `calculateDailyPrice = (billingPrice/cycle)/30`(**30 天基**),而全站续费/退款/升级都用 **31 天基**。且延期只加 `days` 个自然日。
  - 疑点:同一实例,延期 30 天要付整整 1 个月的钱却只得 30 天;而续费 1 个月付同样的钱得 31 天。日价还比续费高 ~3.3%。两套天数口径并存。
  - 需 owner 确认:延期日价应改成和续费一致的 31 天基吗?(现在是 /30,和全站 /31 冲突)

- **[BF-1-02] 经济倒挂/不一致 | admin-billing.ts:2677-2943, 2546-2672 vs instance-destroy.ts:312-318**
  - 现状:用户自助销毁托管实例时会从**节点主人**余额回扣退款;但管理员"退款/删除并退款"**完全不回扣**节点主人。`full` 模式还能退超过剩余价值的金额。
  - 疑点:管理员给托管实例退款时,平台独自承担损失,reseller 白拿全部收入;两条退款路径对"钱从谁扣"的处理相反。
  - 需 owner 确认:管理员给托管实例退款时,是否也应从节点主人余额回扣?(现在不扣)

- **[BF-1-03] 规则可疑/口径分叉 | billing-operations.ts:210-307(退款) vs billing-calc.ts:231-275(升级/改价)**
  - 现状:销毁退款的剩余价值按**实付账单记录**时间比例算并封顶实付总额(安全);而升级差价、管理员改价的剩余价值按 **instance.billingPrice(名义原价)× 剩余天数** 算,**不封顶实付**。秒杀/优惠码买家 billingPrice 存的是原价。
  - 疑点:秒杀 ¥10 买了名义 ¥100 的方案,升级时按 ¥100 折算剩余价值来抵扣新方案费用 → 可能过度抵扣、少收甚至倒贴。两处"剩余价值"口径不同。
  - 需 owner 确认:升级/改价的"剩余价值"是否也应按实付(秒杀/折扣后价)计算?(现在按名义原价)

- **[BF-1-04] 规则可疑/功能残缺 | billing-scheduler.ts:791, 42 + instance-suspend.ts:188-199**
  - 现状:实例一到期(≤30 分钟内)立即封停停机,封停满 3 天才删除;到期与封停之间**没有任何宽限期**。到期提醒也只有到期前 3 天一次。
  - 疑点:很多平台在到期后给 N 天"服务仍运行"的宽限。这里到期即停机,用户可能在没有第二次提醒的情况下服务中断。
  - 需 owner 确认:到期后是要"立即停机、3 天后删"(现状),还是要"到期后仍运行 N 天"宽限?

- **[BF-1-05] 内部矛盾 | billing-scheduler.ts:161-162 vs instance-billing.ts:631-652**
  - 现状:托管实例**手动续费被限制"仅 1 个月、仅到期前 7 天"**;但**自动续费**按 instance.billingCycle 月数续(若卖的是季付/年付会一次续 3/12 个月),不受"仅 1 个月"限制。
  - 疑点:同一实例,自动续费能一次续多月,手动却只能续 1 个月,规则自相矛盾。
  - 需 owner 确认:托管实例的自动续费是否也应限制为每次 1 个月?

- **[BF-1-06] 规则可疑 | instance-destroy.ts:260-268, 119-122**
  - 现状:销毁手续费"首次免、之后 10%"按**用户全局销毁次数**判定,不按实例、不按时间窗。
  - 疑点:用户第一次销毁任何实例免费,此后销毁任何实例(哪怕相隔很久)一律 10%。
  - 需 owner 确认:免手续费是"每个用户一生仅首次",还是应按周期/按实例重置?

- **[BF-1-07] 经济倒挂(轻微) | billing-calc.ts:309-314**
  - 现状:`1 个月 = 31 天` 直接加天。月付实例每续 1 个月得 31 天。
  - 疑点:长期看平台系统性多交付时长(相对真实日历偏多)。
  - 需 owner 确认:统一按 31 天/月交付是有意为之吗?

- **[BF-1-08] 数据口径瑕疵(轻微) | billing-operations.ts:660-667**
  - 现状:已过期后再续费时,续费账单 periodStart 记为**旧到期时间(过去)**,而实际服务期从 now 起算。退款按 periodEnd−periodStart 算比例时分母被"空档"撑大。
  - 疑点:过期后续费的实例,后续销毁退款的剩余价值会被**低估**(对用户不利)。
  - 需 owner 确认:续费账单的 periodStart 应取 max(旧到期, now) 吗?

- **[BF-1-09] 功能残缺(轻微) | billing-scheduler.ts:43, 623**
  - 现状:到期提醒只在到期前 3 天发一次,且 autoRenew=true 的实例完全不提醒。
  - 需 owner 确认:是否需要增加到期前 1 天/当天提醒?

---

## 三、给 owner 的 TOP5 必答确认问题

1. **延期日价口径**:管理员"延期"按 月价/30 计费(全站其它都按 /31),同样的钱延期只得 30 天、续费得 31 天且日价更高——要统一成 31 天基吗?(admin-billing.ts:796-799, 2384 vs billing-calc.ts:17-33)
2. **托管实例管理员退款不回扣节点主人**:用户自助销毁会从节点主人扣回退款,但管理员退款/删除退款都不扣,full 模式还能退超剩余价值——平台自担损失、reseller 白拿收入,这是有意的吗?(admin-billing.ts:2677-2943 vs instance-destroy.ts:312-318)
3. **升级/改价用名义原价算剩余价值,不封顶实付**:秒杀/优惠码买家升级时按原价折算剩余价值抵扣,可能过度抵扣甚至倒贴——升级是否也应按实付计算并封顶?(billing-calc.ts:231-275 + instances.ts:1859)
4. **到期即停机、无宽限**:实例到期 30 分钟内即封停停机,3 天后删除,中间服务不再运行——保留现状,还是"到期后仍运行 N 天"宽限?(billing-scheduler.ts:791 + instance-suspend.ts:188-199)
5. **托管实例自动续费绕过"仅1个月"限制**:手动续费限每次 1 个月,自动续费却按原周期(可多月)——两者要统一吗?(billing-scheduler.ts:161-162 vs instance-billing.ts:631-652)

说明:本次为只读审计,未改任何文件。降级路径代码存在但用户端被双重拦截,用户侧无降级套利;管理端改价可下调价格并退差价,属管理员主动操作。
