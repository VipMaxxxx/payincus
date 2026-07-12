# BF-8 秒杀 / 礼品卡 / 兑换码 · 业务行为说明书 + 疑点清单

## 一、现状行为

### A. 秒杀：活动配置 → 抢购 → 扣费 → 交付

1. 管理员创建活动时配置名称、起止时间、状态、账号最小时长、邮箱要求、Turnstile、风控拦截及活动 `maxPerUser`；每个商品另配秒杀价、库存、商品限购、优惠码和 AFF 开关。创建时只要求结束时间晚于开始时间；秒杀价允许为 0，也未要求低于原价。`server/src/routes/flash-sales.ts:90`、`server/src/routes/flash-sales.ts:128`、`server/src/services/flash-sales.ts:367`、`server/src/services/flash-sales.ts:401`

2. 前端按“元”填写秒杀价，提交时乘 100；后端及数据库以“分”保存。成交时再除以 100 转成余额元金额。原价只在活动创建时从方案价格做一次快照。`client/src/views/admin/FlashSalesView.vue:204`、`server/src/services/flash-sales.ts:407`、`server/src/services/flash-sales.ts:410`、`server/src/routes/instances.ts:1411`

3. `scheduled`、`active`、`paused` 且尚未过结束时间的活动会出现在用户列表。展示状态由当前时间动态计算：到达开始时间后，`scheduled` 会被显示为 `active`；但真实下单要求数据库状态本身等于 `active`，代码没有自动把 `scheduled` 改成 `active` 的调度器。`server/src/services/flash-sales.ts:52`、`server/src/services/flash-sales.ts:202`、`server/src/services/flash-sales.ts:643`

4. 用户抢购仍进入普通实例创建链：套餐必须可访问、付费方案必须有效且未售罄、必须满足前置套餐、共享配额、镜像、SSH 密钥和宿主机资源等条件。秒杀不是先锁库存再补资料，而是在完整创建事务中扣余额、创建实例、创建账单和秒杀记录。`server/src/routes/instances.ts:1273`、`server/src/routes/instances.ts:1339`、`server/src/routes/instances.ts:1441`、`server/src/routes/instances.ts:1691`、`server/src/routes/instances.ts:1831`

5. 秒杀资格要求：活动数据库状态为 `active`，当前时间在窗口内，剩余库存大于 0，账号状态为 active；可选要求邮箱、账号年龄、无风控限单以及 Turnstile。活动开启 Turnstile，但全局 Turnstile 配置为关闭时，不做验证。`server/src/services/flash-sales.ts:643`、`server/src/services/flash-sales.ts:654`、`server/src/services/flash-sales.ts:661`、`server/src/services/flash-sales.ts:664`、`server/src/services/flash-sales.ts:670`、`server/src/services/flash-sales.ts:689`

6. 库存公式为：

   `剩余库存 = max(0, totalStock - soldCount - reservedCount)`

   实际成交直接令 `soldCount + 1`；当前仓库没有任何增加 `reservedCount` 的路径，因此“锁定库存”字段实际恒为初始值 0。交付失败会令 `failedCount + 1、soldCount - 1`，重新释放名额。`server/src/services/flash-sales.ts:33`、`server/src/services/flash-sales.ts:767`、`server/src/services/flash-sales.ts:783`、`server/src/services/flash-sales.ts:816`

7. 有效限购值为：

   `max(1, min(商品 perUserLimit, 活动 maxPerUser))`

   但购买次数只按 `itemId + userId` 统计，即每个商品分别计数，不是整个活动跨商品合计。管理端创建时又把活动 `maxPerUser` 自动设为所有商品限购的最大值，通常不会产生额外的活动级限制。`server/src/services/flash-sales.ts:677`、`server/src/services/flash-sales.ts:678`、`client/src/views/admin/FlashSalesView.vue:191`

8. 用户端展示“每人限购活动 `maxPerUser` 台”，管理端称其为“活动总限购”；这与后端逐商品计数口径不一致。`client/src/views/FlashSalesView.vue:125`、`client/src/views/admin/FlashSalesView.vue:623`、`server/src/services/flash-sales.ts:678`

9. 优惠入口实际只有实例创建请求中的 `promoCode`，注释和校验函数均表明它是 AFF 优惠码。只要传入该码，秒杀资格要求商品的 `allowCoupon` 和 `allowAff` 必须同时为 true；任一个关闭都会拒绝。因此后台两个独立复选框并不能独立生效。`server/src/routes/instances.ts:1236`、`server/src/services/flash-sales.ts:650`、`client/src/views/admin/FlashSalesView.vue:516`

10. 允许 AFF 后，折扣基数是秒杀价，公式为：

    `实付 = 秒杀价 - AFF 折扣金额`

    AFF 创建者佣金的基数也是折扣前秒杀价。`server/src/routes/instances.ts:1427`、`server/src/routes/instances.ts:1923`

11. 秒杀只影响首次成交金额和首次账单。实例保存的 `billingPrice` 仍是原方案周期价，而不是秒杀实付价；以后续费按该 `billingPrice / billingCycle × 续费月数` 收费，即恢复普通方案月价。`server/src/routes/instances.ts:1857`、`server/src/db/billing-operations.ts:119`、`server/src/db/billing-operations.ts:139`、`server/src/db/billing-operations.ts:339`

### B. 礼品卡：生成 → 余额转移 → 兑换

12. 管理员可单张或批量生成礼品卡。单卡面值、实际到账分别限制为 ¥0.01–¥10,000，二者彼此独立，没有比例或大小关系约束；批量最多 500 张。因此单批最高可发行 ¥5,000,000 实际到账价值。管理员生成不扣管理员或平台资金账户。`server/src/routes/gift-cards.ts:130`、`server/src/routes/gift-cards.ts:150`、`server/src/routes/gift-cards.ts:155`、`server/src/routes/gift-cards.ts:194`、`server/src/db/gift-cards.ts:16`

13. 管理员可指定任意可解析的过期时间，包括已经过去的时间；不填表示永久有效。新卡初始状态仍为 `active`。`server/src/routes/gift-cards.ts:162`、`server/src/db/gift-cards.ts:116`

14. 普通用户可用余额生成 ¥0.01–¥10,000 的礼品卡。生成时：

    `扣除余额 = 面值 = 实际到账金额`

    该扣款使用 `gift_card_issue` 类型，不计入“真实服务消费”以防止转卡刷积分。用户生成的卡永久有效，没有用户可选期限。`server/src/routes/gift-cards.ts:439`、`server/src/db/gift-cards.ts:181`、`server/src/db/gift-cards.ts:197`、`server/src/db/gift-cards.ts:214`、`docs-site/docs/release/version-log.md:92`

15. 用户生成后成为卡的 `ownerId`。持有人禁止兑换自己生成的卡；用户端没有撤销、回收或退款入口。因此余额一旦转为礼品卡，只能由其他账号兑换，或等待管理员处理。`server/src/db/gift-cards.ts:227`、`server/src/db/gift-cards.ts:327`、`server/src/routes/gift-cards.ts:439`

16. 礼品卡兑换是一次性的。成功后卡变为 `used`，兑换者余额增加 `balanceValue`，并写入 `gift` 类型余额流水。到账金额取“实际到账”，不是“面值”。`server/src/db/gift-cards.ts:296`、`server/src/db/gift-cards.ts:347`、`server/src/db/gift-cards.ts:349`、`server/src/db/gift-cards.ts:357`、`server/src/db/gift-cards.ts:364`

17. 过期状态采用懒更新：只有用户尝试兑换时，代码才把到期但仍为 active 的卡改为 `expired`。后台 active 数量和“未兑余额”统计只看状态，不看 `expiresAt`，因此尚未被尝试兑换的过期卡仍计入可用卡和未兑负债。`server/src/db/gift-cards.ts:324`、`server/src/db/gift-cards.ts:330`、`server/src/db/gift-cards.ts:499`

18. 管理员可以停用、重新启用未过期的 disabled 卡，也能删除 active、disabled、expired 卡。删除用户余额生成的未兑卡不会自动退还原发行人的余额。`server/src/db/gift-cards.ts:385`、`server/src/db/gift-cards.ts:392`、`server/src/db/gift-cards.ts:403`

### C. h-码与积分：生成 → 核销 → 资源发放

19. h-码由宿主机所有者或管理员针对某一宿主机生成。支持 CPU、内存、磁盘和流量，不支持积分类型。单码最多使用 1,000 次；批量一次最多生成 100 个一次性码，同批次每个用户只能使用一张。`server/src/routes/redeem-codes.ts:12`、`server/src/routes/redeem-codes.ts:13`、`server/src/routes/redeem-codes.ts:114`、`server/src/routes/redeem-codes.ts:284`、`server/src/db/redeem-codes.ts:115`

20. 单次资源范围为：

    - CPU：1%–100%
    - 内存：1 MB–65,536 MB
    - 磁盘：1 MB–1,048,576 MB
    - 流量：1 GB–10,240 GB

    创建时不检查或预占宿主机剩余容量，也不限制创建总批次数或总价值。`server/src/db/redeem-codes.ts:37`、`server/src/routes/redeem-codes.ts:269`

21. h-码核销要求码启用、未过期、未用尽、目标用户匹配、用户未用过同一码或同批次其他码；实例必须属于用户、状态为 running/stopped，并与码绑定的宿主机一致。`server/src/routes/checkin.ts:170`、`server/src/routes/checkin.ts:181`、`server/src/routes/checkin.ts:185`、`server/src/routes/checkin.ts:195`、`server/src/routes/checkin.ts:212`

22. 核销明确“不再检查套餐上限，允许资源无限叠加”。CPU、内存、磁盘直接永久增加实例规格，同时增加宿主机已用资源计数；流量则永久增加实例 `monthlyTrafficLimit`，不是一次性的当月流量余额。`server/src/routes/checkin.ts:233`、`server/src/routes/checkin.ts:286`、`server/src/routes/checkin.ts:306`、`server/src/routes/checkin.ts:326`、`server/src/routes/checkin.ts:346`、`server/src/db/redeem-codes.ts:389`

23. 用户界面的实例下拉框只返回免费实例，即 `packagePlanId = null`；但核销 POST 接口本身没有这一校验，知道付费实例 ID 的用户也可把 h-码应用到自己的付费实例。`server/src/db/checkin.ts:790`、`server/src/db/checkin.ts:795`、`server/src/routes/checkin.ts:262`

24. 用户界面仍声明“兑换码有效期 3 小时、每人每日一次、不能超过套餐上限、仅用于免费实例”。其中前三条属于旧签到兑换码规则，与当前只接受 h-码的接口相反；“仅免费实例”也只由列表隐藏实现。`client/src/locales/zh-CN.ts:6775`、`client/src/locales/zh-CN.ts:6776`、`client/src/locales/zh-CN.ts:6799`

25. 数据库仍保留旧 `CheckinRecord`：3 小时有效期、每日兑换日期、分享限制等逻辑；相关生成/核销函数没有任何路由调用。当前签到实际是每天按配置区间随机直接发积分，不生成兑换码；h-码创建和核销均排除积分 `p`。`server/prisma/schema.prisma:3722`、`server/src/db/checkin.ts:175`、`server/src/db/checkin.ts:219`、`server/src/routes/checkin.ts:74`、`server/src/routes/checkin.ts:97`、`server/src/routes/user-lifecycle.ts:24`

26. 每日积分签到默认随机发 1–500 分，后台可配置到单日最多 100,000 分；采用北京时间日期键，每账号每天一次。连续签到只累计 `streakDays`，没有额外倍率或连续奖励公式。`server/src/db/checkin.ts:27`、`server/src/db/checkin.ts:43`、`server/src/db/checkin.ts:286`、`server/src/db/checkin.ts:313`、`server/src/db/checkin.ts:335`

## 二、业务疑点清单

- [BF-8-01] 功能残缺 | `server/src/services/flash-sales.ts:52`
  - 现状：`scheduled` 活动到点后在用户端显示为“进行中”，抢购按钮可点击，但下单仍要求持久化状态为 `active`；不存在自动转状态逻辑。
  - 疑点：这是典型的“配置了定时活动但不会自动开场”，用户会走到后端拒绝的死胡同。
  - 需 owner 确认：`scheduled` 活动是否应在开始时间到达后自动允许成交，而无需管理员手动点“开始”？

- [BF-8-02] 内部矛盾 | `server/src/services/flash-sales.ts:677`
  - 现状：活动 `maxPerUser` 被展示成活动总限购，但后端按每个 `itemId` 分别计数；用户可在同一活动购买多个不同商品，各自达到上限。
  - 疑点：例如活动限购 1、含 3 个商品时，当前用户最多可买 3 台，而不是 1 台。
  - 需 owner 确认：活动 `maxPerUser` 是否应该跨活动内所有商品合计限购？

- [BF-8-03] 内部矛盾 | `server/src/services/flash-sales.ts:650`
  - 现状：后台独立配置“优惠码”和“AFF 返利”，但唯一的 `promoCode` 是 AFF 码，且两个开关必须同时开启才能使用。
  - 疑点：任意只开一个开关的配置都是死配置；文档却称支持独立“优惠/AFF 策略”。`docs-site/docs/admin/overview.md:35`
  - 需 owner 确认：`allowAff=true` 时是否应独立允许 AFF 折扣和返利，而不再强制 `allowCoupon=true`？

- [BF-8-04] 规则可疑 | `server/src/services/flash-sales.ts:401`
  - 现状：秒杀价允许为 0，也允许高于或等于原方案价，没有最低折扣、最高折扣或“必须低于原价”的规则。
  - 疑点：名为“秒杀”的活动可以变成原价销售、加价销售或免费赠送；是否符合促销定位完全依赖人工。
  - 需 owner 确认：秒杀价是否必须满足 `0 < 秒杀价 < 原方案价`？

- [BF-8-05] 规则可疑 | `server/src/routes/instances.ts:1859`
  - 现状：首期按秒杀价扣款，但实例 `billingPrice` 保存普通方案价，续费立即恢复普通月价。
  - 疑点：用户端秒杀页没有说明“仅首期优惠”；如果业务想做长期特价套餐，当前实现没有达成。
  - 需 owner 确认：秒杀价是否只优惠首次计费周期，续费恢复普通方案价？

- [BF-8-06] 经济倒挂 | `server/src/routes/gift-cards.ts:155`
  - 现状：管理员可让“实际到账”高于面值，最高单卡 ¥10,000、单批 500 张，且不从任何资金账户扣款。
  - 疑点：这是最高单批 ¥5,000,000 的无资金来源余额发行能力；面值与到账额也没有倍率上限。
  - 需 owner 确认：管理员是否应被允许生成“实际到账高于面值”的无资金礼品卡？

- [BF-8-07] 功能残缺 | `server/src/db/gift-cards.ts:327`
  - 现状：用户生成礼品卡后立即扣款、禁止自兑、不能自行撤销；管理员删除或停用也不退款。
  - 疑点：误生成、泄露后想作废、长期无人领取等场景都会把发行人的余额永久卡死或直接销毁。
  - 需 owner 确认：用户余额生成且尚未兑换的礼品卡，是否应允许发行人撤销并原额退回余额？

- [BF-8-08] 内部矛盾 | `server/src/db/gift-cards.ts:330`
  - 现状：礼品卡到期后只有被尝试兑换才转为 expired；后台 active 数和未兑余额仍包含“时间已过但状态未更新”的卡。
  - 疑点：运营看到的可用数量和未兑负债不等于按有效期计算的真实值。
  - 需 owner 确认：后台统计是否应实时按 `expiresAt` 排除已到期礼品卡，而不是等待兑换触发状态更新？

- [BF-8-09] 经济倒挂 | `server/src/routes/checkin.ts:233`
  - 现状：宿主机所有者可无限创建高面值、多次使用的 h-码；创建和核销不校验宿主机剩余容量，资源可无限叠加。
  - 疑点：单码理论上可发放 100,000% CPU、64,000 GB 内存、1,000 TB 磁盘或 10,000 TB 月流量总权益，且没有成本、库存或总发行额度闭环。
  - 需 owner 确认：h-码发行和核销是否应受宿主机实时可用资源及管理员配置的总发行额度限制？

- [BF-8-10] 内部矛盾 | `server/src/db/checkin.ts:795`
  - 现状：前端只列免费实例，但 POST 核销接口接受用户自己的付费实例，并且不检查套餐上限。
  - 疑点：用户可以绕过前端把免费资源码永久叠加到付费实例，改变付费方案实际交付规格。
  - 需 owner 确认：h-码是否必须在后端强制仅允许应用到 `packagePlanId = null` 的免费实例？

- [BF-8-11] 规则可疑 | `server/src/routes/checkin.ts:346`
  - 现状：流量 h-码增加的是永久 `monthlyTrafficLimit`；以后每个计费月都继续享受该增量。
  - 疑点：“流量 +N GB”通常也可能表示一次性流量包；当前实现的长期价值远高于一次性权益。
  - 需 owner 确认：流量 h-码是否应永久增加每月流量额度，而不是只增加当前周期可用流量？

- [BF-8-12] 文档-代码不符 | `client/src/locales/zh-CN.ts:6799`
  - 现状：界面承诺 3 小时有效、每日限兑一次、不能超过套餐上限；当前 h-码有效期可永久、按单码/批次限次，并明确无限叠加。
  - 疑点：用户据此无法正确判断码的期限、使用次数和资源边界。
  - 需 owner 确认：用户端是否应删除旧签到码三条规则，改为展示每张 h-码自己的有效期、次数和“资源永久叠加”规则？

- [BF-8-13] 功能残缺 | `server/src/routes/user-lifecycle.ts:24`
  - 现状：Prisma 枚举和旧代码保留积分码 `p`，但所有现行 h-码创建入口排除 p，核销也拒绝 p；积分只通过每日签到直接入账。
  - 疑点：“积分兑换码”在数据结构上存在、在现行业务上不可生成也不可核销，属于未完成或废弃概念。
  - 需 owner 确认：产品是否正式取消积分兑换码，只保留签到直接发积分？

- [BF-8-14] 功能残缺 | `server/src/db/redeem-codes.ts:457`
  - 现状：宿主机所有者可删除已使用的 h-码；数据库级联同时删除全部使用记录。`server/prisma/schema.prisma:3818`
  - 疑点：后台提供“使用记录”能力，但创建者可把历史核销证据一并清除，无法长期核算已发资源价值。
  - 需 owner 确认：已有使用记录的 h-码是否应禁止物理删除，只允许禁用或归档？

## 三、给 owner 的 TOP5 必答确认问题

1. **是/否：`scheduled` 秒杀到达开始时间后，应自动允许用户成交，无需管理员手动切换为 `active`？**

2. **是/否：秒杀活动的 `maxPerUser` 应跨活动内所有商品合计，而不是每个商品各算一次？**

3. **是/否：用户用余额生成且尚未兑换的礼品卡，应允许发行人撤销并原额退款？**

4. **是/否：h-码必须由后端同时限制为“仅免费实例可用”，并校验宿主机可用容量/总发行额度？**

5. **是/否：秒杀的 AFF 开关应独立生效，即 `allowAff=true` 就可使用 AFF 码，不要求“优惠码”开关也同时开启？**
