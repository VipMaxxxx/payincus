# BF-4 VIP与积分经济 · 业务行为说明书 + 疑点清单

## 一、现状行为(代码实际怎么跑)

### 1. VIP 等级(user 型 与 hosting 型,两套独立)
- **门槛口径**:全局配置 `user_vip_metric` 决定 user 型 VIP 按「累计充值 totalRecharge」还是「累计消费 totalConsume」判级(`vip-levels.ts:167-186`)。切换口径时另一列阈值会在下次保存被清成 null,规则若无有效条件会报错逼管理员重填(`vip-levels.ts:410-421`)。
- **累计消费口径(D-176 后)**:净消费 = Σ(consume) − Σ(挂实例的 refund),只减 instance_id 非空的退款;充值退款、管理员调账退款不减(`balance.ts:549-583, 576-578`)。
- **判级**:实时计算,取满足条件的最高等级(`vip-levels.ts:483-489`)。**无「历史最高锁定」——净消费/收入下降会即时降级**。
- **VIP 等级实际产出**:只有「等级数字 + 徽章配色 + 升级进度条」。在 `instances.ts:2417-2436`、`packages.ts:2417-2424`、`hosting.ts:822-838`、`admin-hosting.ts:95-100/365-378` 里 VIP 等级**仅用于展示与管理端排序**。
- **下单/续费折扣走 AFF 优惠码,不是 VIP**(`instance-billing.ts:447-451, 554`;billing-calc.ts 的 discountRate 全部来自 AFF)。**全代码库无任何「按 VIP 等级给折扣/配额/流量/特权」的逻辑。**

### 2. VIP 权益(唯一真正发放的通道:VipBenefitReward「权益领取」)
- 管理端在 VipBenefitHallSettings.vue 配置 VipBenefitReward(每条:等级 + 类型 balance/points/instance + 领取上限 claimLimit)。
- 用户领取(`vip-benefits.ts:581-740`):必须等级≥奖励等级;**必须先领完所有更低等级的奖励**才能领高等级(阻塞逻辑);balance 直接加余额记 gift 日志;points 直接加积分;instance 置 pending 待人工发放。
- **领取记录永久保存,无 clawback**:降级后已领的余额/积分/实例不回收,且因 claimLimit 无法重复领。
- claim-all 循环最多 1000 次自动把所有可领的领完(`:749-763`)。

### 3. 积分「赚」端
- **消费兑换**:`1 元 = 100 积分`(`points.ts:126, 169`)。用 convertedConsume 锚点防重复:可兑换 = max(0, 净消费 − convertedConsume),兑换后 convertedConsume = 当前净消费。手动触发,无每日上限。
- **每日签到**:积分 = min~max **均匀随机**(`checkin.ts:63-65, 316`),默认 min=1 / max=500;requireInstance 默认 false,即**新用户零门槛每天最多白拿 500 积分**(`:124`)。
- **抽奖中奖**:points 类奖品直接加积分(`lottery.ts:668-677`)。
- **VIP 权益领取**:points 类奖励加积分。

### 4. 积分「耗」端
- **抽奖**:每次扣 lottery.costPoints(最低 1);**十连抽**固定 10 次,前置校验积分 ≥ costPoints×10。
- **徽章**:随机抽 500 积分、自选 1500 积分(纯消耗换装饰)。

### 5. 抽奖概率/库存
- 绝对概率:`Math.random()*100` 落区间。单奖品概率 0–100 校验,但**不校验全奖池概率之和**(`admin-entertainment.ts:446-448`)。
- 概率和<100% 且无 nothing 奖品→抽奖抛 LOTTERY_CONFIG_ERROR(事务内回滚扣分)。
- 库存乐观锁 remainQuantity>0 扣减防超发,抽空回退 nothing。
- balance 奖品 value 存分,value/100 直接进真实余额记 gift 日志;prize.value 无上限、与 costPoints 无关联校验(`admin-entertainment.ts:462-463`)。

---

## 二、业务疑点清单

- **[BF-4-01] 规则可疑/功能残缺 | vip-levels.ts 全类;instances.ts:2417、hosting.ts:822、billing-calc.ts**
  - 现状:VIP 等级除「徽章配色+进度条+管理端排序」外,**不带任何下单/续费折扣、资源配额、流量倍率、提现费率等实际权益**。折扣完全由 AFF 优惠码提供。
  - 疑点:预期「各级权益按等级生效」在代码里根本不存在。VIP 目前 = 纯荣誉 + 一次性可领奖励。
  - 需 owner 确认:**VIP 是否本就设计为「只发徽章+可领奖励」、完全不给持续性折扣/配额?**

- **[BF-4-02] 功能残缺(死配置) | vip-levels.ts:36-54, 242-311**
  - 现状:VIP 规则的 benefits.benefitHall 被完整归一化+严格校验,但**全库无任何地方读取它来发放**;真正的可领奖励走另一张表 VipBenefitReward。
  - 需 owner 确认:**benefitHall 是否确认为废弃字段、可清理?**

- **[BF-4-03] 文档-代码不符/死代码 | checkin.ts:849-861、219-284**
  - 现状:userHasPaidInstance 注释写「有付费实例=500,无=100」,但实际签到用 min~max 均匀随机,**从不调用该函数**;另一套发资源到资源池的 performCheckin 也**完全无路由调用**(死代码)。
  - 需 owner 确认:**签到就是「min~max 随机积分」这套,分层发放/发资源两套遗留可判死清理,对吗?**

- **[BF-4-04] 功能残缺 | checkin.ts:335-337, 316**
  - 现状:签到计算并展示 streakDays,但发放积分与连续天数无关——**没有连续签到递增奖励曲线**。
  - 需 owner 确认:**连续签到是否应有递增奖励(如第7天翻倍)?现状「连签无额外奖励」符合预期吗?**

- **[BF-4-05] 经济倒挂/可刷(源头风险) | checkin.ts:27-28,124;lottery.ts:636-667;admin-entertainment.ts:462**
  - 现状:①签到默认无门槛每天最多白拿 500 免费积分;②抽奖 balance 奖品把积分直接换真实余额;③balance 奖品面值无上限、与 costPoints 无比价校验;④全奖池概率之和不校验。整条「免费积分→抽奖→真实余额」通路打通,安全**完全取决于管理员把概率/costPoints/面值调对**。
  - 疑点:一旦某抽奖配成「期望余额产出>消耗积分价值」即成薅真金资金泵;系统无内置比价护栏(积分无锚定价值)。
  - 需 owner 确认:**是否接受「积分↔余额无系统级比价护栏、全靠人工配置」?要不要加「单抽期望余额≤costPoints对应价值」硬校验?**

- **[BF-4-06] 经济不一致(有界小漏) | points.ts:125-190;balance.ts:576-578**
  - 现状:D-176 后累计消费按净额计且 convertedConsume 只增不减,**无法反复薅**;但**已按消费兑换出的积分,在事后实例退款时不回收**:「买¥10→兑1000积分→销毁全额退¥10」后净消费回 0 而用户白留 1000 积分(一次性、以历史峰值净消费为上限,不可无限循环)。
  - 需 owner 确认:**「消费兑换过积分后再退款,积分不追回」是否可接受?**

- **[BF-4-07] 规则待确认(降级不追回) | vip-benefits.ts:581-740(无 revoke)**
  - 现状:用户升到高等级、领走该级 balance/points/instance 奖励后,若净消费/收入下降导致降级,**已领奖励永久保留**,且因 claimLimit 无法重复领。
  - 疑点:「冲一波消费→升级领奖→退款降级→保留奖励」可一次性套出等级奖励(被 claimLimit 限一次)。
  - 需 owner 确认:**VIP 权益奖励「领了就永久归属、降级不回收」是否为预期规则?**

---

## 三、给 owner 的 TOP5 必答确认问题

1. **VIP 到底给不给「实打实的持续权益」?** 目前只发徽章+进度条+一次性可领奖励,下单/续费无 VIP 折扣、无 VIP 配额/流量/费率优惠(折扣只来自 AFF 码)。这是预期,还是漏做了权益逻辑?(vip-levels.ts 无折扣产出;instance-billing.ts:554 折扣源为 AFF)
2. **积分↔余额要不要加系统级比价护栏?** 签到默认零门槛每天白拿最多 500,抽奖 balance 奖品可换真实余额,面值无上限、概率和不校验,安全全靠人工配。(checkin.ts:27-28,124;lottery.ts:636-667;admin-entertainment.ts:446-463)
3. **签到规则以哪套为准?** 实际是「min~max 均匀随机积分、连签无递增、无资源发放」,代码里遗留「分层500/100」和「发资源」两套从不被调用的死逻辑。确认现状为准并清理?(checkin.ts:63-65,316 vs 死函数 :219-284,849-861)
4. **VIP 权益奖励「降级不回收、消费退款不冲减积分」是否可接受?** 存在「冲消费→升级领奖/兑积分→退款降级→保留收益」的一次性获利路径(被 claimLimit 与 convertedConsume 锚点限制为不可无限循环)。
5. **benefitHall 死配置能否判废清理?** 被完整校验却从不发放,与真正生效的 VipBenefitReward 并存,属双轨遗留易误配。

说明:只读业务审计,未改任何文件、未跑构建/测试。
