# BF-6 流量计费与限速/风控 · 业务行为说明书 + 疑点清单

> 只读审计,未改动任何文件。覆盖 routes/traffic.ts、services/traffic-*、instance-traffic-collector.ts、lib/incus/incus-traffic.ts、services/resource-risk.ts、user-order-restrictions.ts、db/traffic.ts、schema.prisma。

## 一、现状行为

### 1. 流量计费口径
- **单位**:字节(UserQuota/Instance.monthlyTrafficUsed 均 BigInt)。
- **方向**:进+出**双向求和**计费——totalDelta = rxIncrement + txIncrement(instance-traffic-collector.ts:85)。无"只计出站/取较大方向"。
- **计哪些网卡**:只计 Incudal 外联网卡(LXC eth0/eth1,VM 按 MAC 匹配),排除 lo/docker/veth/隧道等,避免重复计量;无严格计费网卡时回退统计 eth*/en*。
- **采集**:每 3 分钟一次,读 state 计数器求增量。
- **归零处理**:current<last(重启/回绕)增量记 0,只重建基线**不追补**——每次重启少计重启前那段窗口。
- **双账本**:同一 delta 同时累加到实例 与 用户 UserQuota,并写 dailyTraffic/instanceResourceSample。
- **限额来源**:实例限额=套餐 monthlyTrafficLimit 或方案 trafficLimit × packageHost.trafficMultiplier;用户级限额默认 null=无限制。

### 2. 月度重置时机与时区
- **用户级**:每月 **1 号 00:05** 重置(自然月)。
- **实例级**:每天 00:05 检查,按各节点 host.trafficResetDay(1-28,默认1)重置。
- **解耦**:用户级固定1号,实例级跟随节点重置日,节点日≠1 时两账本周期错位。
- **时区**:全走服务器本地时间,systemd 与 cron **均未固定 TZ**,重置时刻取决于服务器 OS 时区。

### 3. 超量规则(通知/限速/封停)
- **预警 80%**:used≥limit*80%,**仅按用户级限额**判定;用户级默认 null 故常规用户无预警。
- **限速 100%**:used≥limit,**用户级 OR 实例级任一超限**即限速。限速=把 nic limits.ingress/egress **硬编码 1Mbit**,发一次通知。
- **封停**:流量超量链路**无封停**,只限速。封停只来自资源风控。
- **恢复**:再次低于限额时恢复为方案 trafficLimitSpeed 或套餐 limitsIngress。

### 4. 风控评分 → 自动降级/恢复
- **默认策略**:带宽≥100Mbps持续45min→+18;CPU≥90%持续45min→+15;PPS≥20000→+25;小包高频→+25。满分100。
- **QoS 档**:50→50Mbps、65→30Mbps、80→10Mbps;达档写实例 limits={mbps}Mbit。
- **限单**:分≥70 或档位标记 restrictOrders → 建 UserOrderRestriction,禁建实例/购买,需工单人工解除。
- **自动封停**:分≥90 且 autoSuspendEnabled(**默认 false**)→停机。
- **衰减**:scoreDecayPerHour 默认3,仅无触发时 decay=floor(elapsedHours*3);风控每 5 分钟跑,floor(0.083*3)=0→**衰减恒为0(D-006)**,lastEvaluatedAt 每轮刷新时间差不累积。
- **自动恢复**:canRecoverQos 要求 nextScore≤recoverScore 且无触发;因衰减恒0、无触发时 delta 也0,nextScore 永不下降→**QoS 自动恢复整链永不触发**,只能人工 release。
- **可编辑性**:scoreDecayPerHour、packetSmallRatioThreshold **不在**管理端策略更新白名单,admin 改不了衰减;packetSmallRatioThreshold 全程未被读取(死字段)。

### 5. 带宽/QoS 与套餐规格一致性
- 限速档 1Mbit 对所有套餐硬编码;QoS 档是绝对 Mbps(50/30/10)不按套餐缩放。
- 方案 trafficLimitSpeed schema 注释"流量超限后的限速值",但代码把它当**正常线速**(建实例即用它做 limits,恢复也用它),默认 "1Mbit"。

---

## 二、业务疑点清单

- **[BF-6-01] 计费方向 | instance-traffic-collector.ts:85** — 进+出双向求和计入配额。多数 NAT VPS 商只计出站或取较大值,双向计费让下载大文件用户很快触顶。需确认:**配额应按"进+出双向合计"计费,还是改只计出站/取较大方向?**
- **[BF-6-02] 实例超量无预警 | traffic-scheduler.ts:162-173** — 80% 预警只按用户级限额判定,而用户级默认 null;实际生效的是实例级限额,却**无任何预警**,用户毫无预告被限速到 1Mbit。需确认:**是否给实例级也加 80% 预警?**
- **[BF-6-03] 用户级 vs 实例级重置周期错位 | traffic-scheduler.ts:672/528-559** — 用户配额固定每月1号清零,实例配额按节点 trafficResetDay 清零,两账本同一 delta 累加却不同日重置。需确认:**用户级是否也跟随节点重置日(或废弃用户级限额统一以实例级为准)?**
- **[BF-6-04] 重置时区未固定 | traffic-scheduler.ts:667-694** — 所有重置走服务器本地时区,TZ 未固定;若服务器 UTC 而运营在 UTC+8,"月初00:05重置"实际发生北京时间08:05,跨日边界偏移8h。需确认:**流量重置与日聚合是否固定按北京时间(Asia/Shanghai)?**
- **[BF-6-05] 风险分衰减恒0→永久限速(D-006) | resource-risk.ts:255-256/1224** — 5分钟节奏 floor(0.083*3)=0,衰减永不生效,QoS 自动恢复条件永不满足,被限速实例只能人工解。一段异常把分抬到限速档后带宽被**永久**压到 QoS 档并可能长期限单。需确认:**风险分衰减应如何定义?(建议按"距上次触发累计时长每小时扣N分"),请给目标衰减速率(如每小时-5分)。**
- **[BF-6-06] 衰减速率管理端改不了+死字段 | resource-risk.ts:208-224** — buildPolicyUpdate 未含 scoreDecayPerHour,admin 改不了;packetSmallRatioThreshold 定义了但从不使用。需确认:**是否把 scoreDecayPerHour 纳入策略可编辑项并移除/接线 packetSmallRatioThreshold?**
- **[BF-6-07] QoS 档用绝对带宽不随套餐缩放 | schema.prisma:2091/resource-risk.ts:357** — QoS 档固定 50/30/10 Mbps。对正常线速仅10Mbit的低配套餐 tier1(50) 反而是"升速";对1Gbit套餐 tier3(10) 是极重打击。降级对不同套餐惩罚力度完全不一致。需确认:**QoS 降级是否应按套餐正常带宽的百分比(50%/30%/10%)?**
- **[BF-6-08] 方案 trafficLimitSpeed 语义与字段名相反 | instances.ts:1802,1818/schema.prisma:4220** — 字段名/注释是"流量超限后的限速值",代码却当**正常线速**用(建实例即用它做 limits,恢复也回到它),默认1Mbit。管理员按字面填"惩罚速度"(填低)实际把客户正常带宽设低。需确认:**trafficLimitSpeed 到底是"正常线速"(代码现状)还是"超量惩罚速度"(注释)?二者相反,需定义并统一改名/注释。**
- **[BF-6-09] 通知文案写死与实际不符 | traffic-notifier.ts:116-117,174-176** — 预警写死"限速至1Mbit",限速写死"下月1日自动重置"。方案实例恢复速度可能非1Mbit;实例按节点重置日重置,≠1时"下月1日"是错的。需确认:**通知文案是否改为按实际恢复带宽与实际节点重置日动态生成?**
- **[BF-6-10] 流量包半实现 | traffic-scheduler.ts:130,187/schema.prisma:910-911** — extraTrafficQuota 只加进用户级有效限额;extraTrafficUsed 全程无处写入(死字段)。而限速判定主要看实例级,实例级无额外配额概念。给用户加流量包在"实例级限额+无用户级限额"常规场景**不解除**实例限速,等于买了没用。需确认:**流量加油包是否应作用于实例级限额?**
- **[BF-6-11] 付费自助重置只清实例账本 | traffic.ts:451-462** — 付费重置(扣 trafficResetPrice)只清实例 monthlyTrafficUsed,不清用户配额与当日 dailyTraffic。若用户设了用户级限额,付费重置后仍超限仍被限速,钱白花。需确认:**付费重置是否应同时扣减用户级已用量?**
- **[BF-6-12] trafficResetPrice 单位(分/元)易误配 | schema.prisma:1327/traffic.ts:45-54,405** — 字段 Decimal(10,2) 注释"(分)",代码按分处理。两位小数常被当"元"填,管理员填 5.00 以为5元实际按5分收。需确认:**重置价格以"分"还是"元"存储?(需与后台输入提示统一)**
- **[BF-6-13] 两套限速系统共用同一带宽字段 | resource-risk.ts:605-606/traffic-scheduler.ts:214-219** — 流量超量限速与风控 QoS 两套独立逻辑都读写 limitsIngress/egress 并各自捕获/恢复 original,彼此不感知,叠加时恢复目标可能取到对方的限速值。需确认:**两者是否统一到一个带宽仲裁点(明确优先级)?**

---

## 三、给 owner 的 TOP5 必答确认问题
1. **计费方向**:月流量配额应"进+出双向合计"计费吗?(instance-traffic-collector.ts:85)——直接决定用户多快触顶,最核心口径。
2. **实例超量要不要预警**:目前实例级超量**直接限速、零预警**(80%预警只对设了用户级限额的极少数用户生效)。是否给实例级也加 80% 预警?
3. **风险分衰减规则(D-006 业务定义)**:衰减恒0→一次异常=**永久限速+可能永久限单**只能人工解。请拍板衰减规则与速率,否则自动降级只降不升。
4. **QoS 降级是否随套餐缩放**:现固定 50/30/10 Mbps,对低配是"升速"、对高配是重击。应否按套餐正常带宽百分比降级?
5. **方案 trafficLimitSpeed 到底是什么**:字段名/注释说"超量惩罚速度",代码当"正常线速"用且默认1Mbit。含义相反,配错就是"客户平时只有1Mbit"或"超量不惩罚",必须先定义清楚。

附:重置时区(BF-6-04)、通知文案写死(BF-6-09)、流量包对实例级无效(BF-6-10)、重置价格分/元歧义(BF-6-12)为次高优先。
