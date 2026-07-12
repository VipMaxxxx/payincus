# BF-9 邮箱托管业务 · 业务行为说明书 + 疑点清单

## 一、现状行为

### 1. 邮箱源与套餐配置

1. 管理员先配置邮箱源：CraneMail API 地址/API Key、SmarterMail 地址、启用状态和排序。套餐绑定一个邮箱源。`server/prisma/schema.prisma:4846-4862`
2. 套餐包含：

   - 域名数 `domainLimit`：1–1000；
   - 存储 `diskLimitGb`：1–102400 GB；
   - 周期：`monthly` 或 `yearly`；
   - 价格：大于 0、最多两位小数。  
   `server/src/routes/mail.ts:85-163`
3. 用户购买时，`domainLimit`、`diskLimitGb` 会复制到订阅，形成购买时快照；价格和计费周期不快照，续费、退款仍读取当前关联套餐。`server/src/routes/mail.ts:1137-1146`、`server/prisma/schema.prisma:4888-4906`
4. 管理员后续修改套餐价格或计费周期，会影响老订阅续费和退款；修改域名数/空间则不会影响老订阅已有配额。`server/src/routes/mail.ts:635-665`、`server/src/routes/mail.ts:1223-1228`、`server/src/routes/mail.ts:773-788`

### 2. 用户购买订阅

1. 用户端列出所有已启用邮箱源及启用套餐。`server/src/routes/mail.ts:890-919`
2. 后端业务意图是“每个用户只能有一个邮箱订阅”：

   - 首次预检只查询 `active` 订阅；
   - 事务内则查询该用户任意状态的历史订阅，只要存在就拒绝新购。  
   `server/src/db/mail.ts:334-349`、`server/src/routes/mail.ts:1027-1031`、`server/src/routes/mail.ts:1095-1100`
3. 新购价格：

   - 原价 `P = plan.price`；
   - 使用邮箱优惠码后，折扣额 `P × discountRate`，四舍五入到分；
   - 实付 `P - 折扣额`。  
   `server/src/routes/mail.ts:1044-1065`
4. 邮箱只接受全局 AFF 码，套餐专属实例码不能用于邮箱；禁止使用自己的码。`server/src/db/aff.ts:1070-1111`
5. 新购有效期：

   - 月付：当前时间用 `setMonth(+1)`；
   - 年付：当前时间用 `setFullYear(+1)`。  
   `server/src/routes/mail.ts:1076-1082`
6. 购买事务只完成余额扣款、余额流水、订阅创建和 AFF 结算，不调用上游开通。真正的上游资源创建发生在用户随后“添加域名”时。`server/src/routes/mail.ts:1084-1168`
7. 用户端购买成功后才显示订阅，并引导添加域名。`client/src/views/MailView.vue:163-203`

### 3. 邮箱码折扣与返利

1. 使用优惠码新购时，订阅永久绑定该码。`server/src/routes/mail.ts:1153-1157`
2. 推荐人佣金按折扣前原价计算：

   - 佣金 `C = originalPrice × commissionRate`；
   - 用户折扣也按原价计算；
   - 佣金进入推荐人的 `affBalance`。  
   `server/src/routes/mail.ts:1158-1165`、`server/src/db/aff.ts:1131-1171`
3. 续费继续沿用永久绑定码：

   - 码启用时，用户继续获得折扣；
   - 推荐人继续按续费原价获得佣金。  
   `server/src/routes/mail.ts:1230-1241`、`server/src/routes/mail.ts:1321-1329`
4. 如果续费时优惠码已经禁用，用户不再获得折扣；但代码仍因存在绑定而调用返利函数，返利函数本身不检查 `enabled`，因此推荐人仍会获得佣金。`server/src/routes/mail.ts:1237-1241`、`server/src/routes/mail.ts:1321-1329`、`server/src/db/aff.ts:1140-1151`

### 4. 域名开通与配额

1. 只有 `active` 订阅能添加域名；域名数量按订阅快照 `domainLimit` 限制。`server/src/routes/mail.ts:1452-1459`、`server/src/routes/mail.ts:1482-1486`
2. 域名唯一性范围是“同一邮箱源”，即同一域名可以分别存在于不同邮箱源。`server/prisma/schema.prisma:4931`
3. 添加域名时调用 CraneMail：

   - `disklimit = 订阅 diskLimitGb`；
   - `userlimit = 0`、`maxusers = 0`，表示无限账号；
   - 启用 SpamExperts、文件存储和 Office。  
   `server/src/services/cranemail.ts:97-114`
4. 因为每添加一个域名都把完整的 `diskLimitGb` 传给上游，所以含 N 个域名的订阅，实际上最多配置出 `N × diskLimitGb` 的上游域名空间。`server/src/routes/mail.ts:1501-1504`
5. 上游创建域名后，保存本地域名及上游返回的管理员凭证；如有凭证，同时建立管理员邮箱记录，并给它完整的 `diskLimitGb × 1024 MB`。`server/src/routes/mail.ts:1508-1527`
6. 域名初始为 `pending`。用户调用验证后查询 CraneMail，验证成功才改成 `verified`。没有验证期限或自动清理。`server/prisma/schema.prisma:4826-4830`、`server/src/routes/mail.ts:1557-1589`
7. 只有 `verified` 域名能新建普通邮箱账号。`server/src/routes/mail.ts:1702-1709`
8. 普通账号数量没有本地上限；单账号容量：

   - 默认 `min(2048 MB, 订阅空间)`；
   - 最大允许等于整个订阅的 `diskLimitGb × 1024`；
   - 没有校验所有账号容量之和。  
   `server/src/routes/mail.ts:1711-1717`、`server/src/routes/mail.ts:1719-1740`
9. 用户删除域名时先删除上游，再删除本地；删除后立即释放一个本地域名名额。`server/src/routes/mail.ts:1622-1653`

### 5. 续费

1. 后端接受 1–12 的任意整数月数。`server/src/routes/mail.ts:291-296`
2. 月付套餐月价为 `plan.price`；年付套餐月价为 `plan.price / 12`。续费原价：

   `originalPrice = round(月价 × 续费月数, 2)`  
   `server/src/routes/mail.ts:1223-1228`
3. 用户端对月付只提供 1/3/6/12 月；对年付只显示并提交 12 月，但后端没有限制年付必须是 12 月。`client/src/views/MailView.vue:807-816`
4. 新到期日从 `max(当前到期日, 当前时间)` 起，用 `setMonth(+续费月数)` 延长；续费后状态改为 `active`。`server/src/routes/mail.ts:1310-1319`
5. 续费只更新本地到期时间，不调用 CraneMail `unsuspendDomain` 或其他恢复操作。`server/src/routes/mail.ts:1315-1319`

### 6. 到期与自动续费

1. `autoRenew` 字段默认 `false`，用户订阅接口会返回它。`server/prisma/schema.prisma:4893-4897`、`server/src/routes/mail.ts:965-983`
2. 邮箱模块没有开启/关闭自动续费的用户接口，也没有邮箱自动扣款任务。
3. `getExpiringSubscriptions()` 虽能查询 `autoRenew=true` 的临期订阅，但仓库内没有业务调用者。`server/src/db/mail.ts:741-754`
4. 到期调度器启动时执行一次，之后每小时执行；它只把到期的 `active` 订阅更新为 `expired`。`server/src/services/mail-expiry-scheduler.ts:13-45`、`server/src/services/mail-expiry-scheduler.ts:54-77`
5. 到期调度器不调用已实现的 `suspendDomain()`；`suspendDomain()`、`unsuspendDomain()`、`modifyDomain()` 在邮箱业务中均没有调用者。`server/src/services/cranemail.ts:202-236`
6. `getUserMailSubscription()` 只返回 `active`，因此订阅变成 `expired` 后：

   - 用户首页把它当作“没有邮箱服务”，自动切到购买页；
   - 续费接口也返回“没有邮箱订阅”；
   - 购买事务又会因历史 `expired` 订阅仍存在而拒绝新购。  
   `server/src/db/mail.ts:334-349`、`client/src/views/MailView.vue:83-104`、`server/src/routes/mail.ts:1213-1216`、`server/src/routes/mail.ts:1095-1100`
7. 域名详情、密码查看、验证、账号增删改等接口只检查域名属于当前用户，不检查订阅是否仍为 `active`。知道域名 ID 的用户仍可直接访问旧域名管理路径。`server/src/routes/mail.ts:1383-1435`、`server/src/routes/mail.ts:1563-1603`、`server/src/routes/mail.ts:1702-1709`

### 7. 退订与退款

1. 没有用户自助退订接口；只有管理员可以退订。支持：

   - `none`：不退款；
   - `full`：全额退款；
   - `remaining`：按剩余价值退款。  
   `server/src/routes/mail.ts:740-751`
2. “全额退款”固定退当前 `plan.price`，不是用户实际支付金额，也不是历史新购加续费总额。`server/src/routes/mail.ts:773-779`
3. “剩余价值”公式：

   - 月付周期固定按 30 天；
   - 年付固定按 365 天；
   - `ratio = min((expiresAt-now)/周期毫秒, 1)`；
   - `refund = 当前 plan.price × ratio`。  
   `server/src/routes/mail.ts:779-790`
4. 邮箱退款没有邮箱账单表或“历史消费－历史已退”的上限；实例退款则会逐条读取历史账单周期，并受最大可退金额限制。`server/src/routes/admin-billing.ts:2730-2746`、`server/src/db/billing-operations.ts:145-208`
5. 退订先逐个删除上游域名，全部成功后才进入本地事务，执行余额退款并删除订阅；订阅删除级联删除本地域名、账号和 AFF 绑定。`server/src/routes/mail.ts:793-840`
6. 退款时没有冲回已经发放的 AFF 佣金；删除订阅只删除绑定，已计入推荐人 `affBalance` 的返利保留。`server/src/routes/mail.ts:803-839`、`server/prisma/schema.prisma:4425-4435`、`server/src/db/aff.ts:1153-1171`

### 8. 文档与用户文案

1. docs-site 只列出 `/mail`、`/mail/domains/:id` 以及后台 `/admin/mail` 能力，没有计费、配额、续费、到期、退款或返利规则说明。`docs-site/docs/user/dashboard.md:44`、`docs-site/docs/admin/overview.md:191`
2. 用户结算文案写“即时开通”“支持随时申请退款”，但代码购买后尚未开通任何上游域名，且退款只能由管理员执行。`client/src/locales/zh-CN.ts:7816-7824`、`server/src/routes/mail.ts:1009-1197`、`server/src/routes/mail.ts:740-751`
3. 域名页固定链接 `/help/mail`，但内置默认帮助文章只有 `getting-started`；是否存在 `mail` 文档完全依赖数据库运营配置。`client/src/views/MailDomainView.vue:313-318`、`server/src/routes/help.ts:22-50`、`server/src/routes/help.ts:303-315`
4. 邮箱源已经配置 `smarterMailUrl`，但用户端 Webmail 地址并不使用它，而是按 source code 硬编码成 `https://us2.workspace.org/` 或 `https://{code}1.workspace.org/`。`server/prisma/schema.prisma:4850-4852`、`client/src/views/MailDomainView.vue:103-110`

## 二、业务疑点清单

- [BF-9-01] 功能残缺 | `server/src/db/mail.ts:334-349`、`server/src/routes/mail.ts:1095-1100`、`server/src/routes/mail.ts:1213-1216`
  - 现状：过期订阅被用户查询隐藏；过期用户不能续费，购买事务又被历史订阅阻止。
  - 疑点：用户进入不可自救状态，只能由管理员删除旧订阅；续费代码中“从当前时间复活过期订阅”的分支实际不可达。
  - 需 owner 确认：**邮箱过期后是否应允许用户续费并恢复原订阅？**

- [BF-9-02] 功能残缺 | `server/src/services/mail-expiry-scheduler.ts:17-45`、`server/src/services/cranemail.ts:202-214`、`server/src/routes/mail.ts:1383-1435`
  - 现状：到期只改本地状态，不暂停上游；旧域名管理接口又不检查订阅状态。
  - 疑点：“到期”没有真正停止服务，页面隐藏与实际服务状态不一致。
  - 需 owner 确认：**邮箱订阅到期时是否必须同步暂停所有上游域名，并在续费后恢复？**

- [BF-9-03] 功能残缺 | `server/prisma/schema.prisma:4897`、`server/src/routes/mail.ts:970`、`server/src/db/mail.ts:741-754`
  - 现状：`autoRenew` 被存储和返回，也有临期查询函数，但没有设置入口和自动扣款执行器。
  - 疑点：这是“配了但不生效”的死开关，后台数据即使设成 `true` 也不会续费。
  - 需 owner 确认：**邮箱业务是否正式支持自动续费？**

- [BF-9-04] 内部矛盾 | `client/src/views/MailView.vue:63-67`、`client/src/views/MailView.vue:476-495`、`server/src/routes/mail.ts:1095-1100`
  - 现状：用户端只阻止在“已有订阅的同地区”购买，允许选择其他地区继续结算；后端却禁止该用户存在任何第二份订阅。
  - 疑点：前端呈现的是“每地区一份”，后端执行的是“全局一份”。
  - 需 owner 确认：**一个用户是否只能拥有一份全局邮箱订阅，而不是每个邮箱源各一份？**

- [BF-9-05] 可薅 | `server/src/routes/mail.ts:291-296`、`server/src/routes/mail.ts:1223-1228`、`client/src/views/MailView.vue:807-816`
  - 现状：年付套餐前端只能续 12 月，后端却接受 1–12 月，并按“年价÷12×月数”收费。
  - 疑点：如果年付价包含年度折扣，用户可绕过页面按年度优惠月均价只续 1 月，破坏月付/年付价格梯度。
  - 需 owner 确认：**年付套餐是否必须只允许按 12 个月整数倍续费？**

- [BF-9-06] 内部矛盾 | `server/src/routes/mail.ts:1076-1082`、`server/src/routes/mail.ts:1310-1314`、`server/src/routes/mail.ts:783-788`、`server/src/lib/billing-calc.ts:302-313`
  - 现状：邮箱有效期按日历月/日历年增加，退款却固定按 30/365 天；实例公共计费的“月”又定义为 31 天。
  - 疑点：同一平台存在日历月、30 天月、31 天月三种口径。二月月付在刚购买时按剩余价值退款也可能只能退约 `28/30`，31 天月份使用一天后仍可能因比例封顶而退全价。
  - 需 owner 确认：**邮箱计费与退款是否应统一采用明确的实际服务区间毫秒比例，而不是固定 30/365 天？**

- [BF-9-07] 经济倒挂 | `server/src/routes/mail.ts:773-790`、`server/src/routes/mail.ts:1044-1065`、`server/src/routes/mail.ts:1223-1241`
  - 现状：退款按当前套餐标价计算，不看折扣后实付，不看历史续费，也不看套餐购买后是否改价。
  - 疑点：可能双向出错：折扣用户可被退得比实际支付更多；续费多期用户又可能只退一份当前周期标价。当前套餐涨价还会直接抬高老订阅退款额。
  - 需 owner 确认：**邮箱退款是否必须以真实余额消费流水和每笔服务周期为唯一依据，并设置“累计退款不超过累计实付”的上限？**

- [BF-9-08] 可薅 | `server/src/routes/mail.ts:1153-1165`、`server/src/routes/mail.ts:803-839`、`server/src/db/aff.ts:1147-1171`
  - 现状：折扣新购后，推荐人按原价获佣；管理员全额退款又按原价退给买家，佣金不冲回。
  - 疑点：设原价为 `P`、折扣率为 `d`、佣金率为 `c`，买家实际支付 `P(1-d)`，退款拿回 `P`，推荐人另保留 `Pc`；关联账户合计获利 `P(d+c)`。是否能实际薅取取决于管理员退款审批强度，但经济公式本身倒挂。
  - 需 owner 确认：**邮箱退款时是否必须按退款比例冲回对应 AFF 佣金及统计？**

- [BF-9-09] 内部矛盾 | `client/src/locales/zh-CN.ts:7771`、`client/src/locales/zh-CN.ts:7803-7806`、`server/src/services/cranemail.ts:97-114`、`server/src/routes/mail.ts:1711-1717`
  - 现状：页面称 `diskLimitGb` 为订阅“总空间”，但每个域名都获得完整空间；每个普通邮箱账号也可单独配置到完整订阅空间，且没有合计校验。
  - 疑点：套餐标注“多个域名、X GB”究竟是订阅总量、每域名容量还是每账号容量不明确，实际配置更接近“每域名 X GB”。
  - 需 owner 确认：**套餐的 `diskLimitGb` 是否应定义为整个订阅下所有域名共享的总空间？**

- [BF-9-10] 内部矛盾 | `server/src/routes/mail.ts:1237-1241`、`server/src/routes/mail.ts:1321-1329`、`server/src/db/aff.ts:1140-1151`
  - 现状：绑定码禁用后，用户续费折扣停止；但只要绑定仍存在，推荐人继续获得佣金，因为返利函数不检查码是否启用。
  - 疑点：同一个“禁用”状态对买家优惠和推荐人返利采用不同口径。
  - 需 owner 确认：**AFF 码禁用后是否应同时停止该绑定产生的续费佣金？**

- [BF-9-11] 功能残缺 | `server/src/routes/mail.ts:1501-1528`、`server/src/routes/mail.ts:793-840`
  - 现状：账号创建已经实现“上游成功、本地失败时删除上游”的补偿；域名创建没有同等补偿。管理员退订又是逐个删除上游，任一中途失败就停止。
  - 疑点：域名上游创建成功后，本地域名或管理员账号落库失败会留下孤儿域名；多域名退订若删到一半失败，会形成部分域名已从上游消失、但所有本地记录仍保留的状态，重试也可能卡在已删除域名。
  - 需 owner 确认：**域名创建和批量退订是否必须采用可重试任务及逐域名状态台账，而不能作为一次同步操作处理？**

- [BF-9-12] 功能残缺 | `server/src/services/cranemail.ts:127-192`、`server/src/services/smartermail.ts:192-252`、`server/src/db/mail.ts:722-738`
  - 现状：上游接口能够返回域名和账号实际用量，本地也有 `diskUsedMb` 字段，但没有同步调用；订阅统计只是汇总长期默认值。
  - 疑点：容量使用统计、超限预警和运营配额观察没有真实数据来源。
  - 需 owner 确认：**邮箱业务是否要求定时同步上游域名及账号实际用量？**

- [BF-9-13] 功能残缺 | `server/src/routes/mail.ts:740-751`、`client/src/locales/zh-CN.ts:7821-7824`
  - 现状：页面称可“随时申请退款”，但没有用户退订/退款申请状态或接口，只有管理员直接删除并退款。
  - 疑点：如果预期走工单，系统没有把工单与邮箱订阅、退款报价和处理状态关联；如果预期自助，则功能尚未提供。
  - 需 owner 确认：**是否确认邮箱退订和退款只能通过人工工单及管理员处理，不提供用户自助申请入口？**

- [BF-9-14] 文档-代码不符 | `docs-site/docs/user/dashboard.md:44`、`docs-site/docs/admin/overview.md:191`、`client/src/views/MailDomainView.vue:313-318`、`server/src/routes/help.ts:22-50`
  - 现状：docs-site 只有路由级功能清单；用户端却链接到 `/help/mail`，代码内置帮助内容中没有该文章。
  - 疑点：计费周期、空间口径、过期处置、退款规则、AFF 返利等关键商业规则没有用户可见的稳定说明，`/help/mail` 也不保证存在。
  - 需 owner 确认：**邮箱功能正式运营前是否必须提供并内置一篇固定 slug 为 `mail` 的业务规则文档？**

- [BF-9-15] 内部矛盾 | `server/prisma/schema.prisma:4850-4852`、`client/src/views/MailDomainView.vue:103-110`
  - 现状：管理员可为每个邮箱源配置 `smarterMailUrl`，但用户 Webmail 链接完全忽略该配置，按地区代码拼接 `workspace.org`。
  - 疑点：新增非 workspace.org 邮箱源时，“配置成功”并不会改变用户登录入口。
  - 需 owner 确认：**用户 Webmail 地址是否应直接来自邮箱源配置，而不是由前端按 source code 硬编码？**

## 三、给 owner 的 TOP5 必答确认问题

1. **邮箱过期后，是否应暂停上游域名，同时允许用户续费恢复原订阅和原域名？**
2. **年付套餐是否必须只能续 12 个月整数倍，并禁止接口按“年价÷12”单月续费？**
3. **邮箱退款是否必须基于真实实付账单逐期计算、限制累计可退额，并同步冲回 AFF 佣金？**
4. **`diskLimitGb` 是否代表整个订阅共享总空间，而不是每个域名各获得一份完整空间？**
5. **一个用户的邮箱订阅范围究竟是全局仅一份，还是每个邮箱源可各购一份？**
