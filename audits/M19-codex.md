# M19 审计报告
## 结论摘要
邮箱托管模块存在多处高风险生命周期与计费一致性问题，整体健康度偏低。最严重的是订阅到期不会停用上游服务、退款依据当前标价而非实付金额，以及取消/创建流程跨数据库与上游操作不具备可靠补偿或并发隔离。

## 发现清单
- [M19-01] P1 | 置信度 高 | server/src/services/mail-expiry-scheduler.ts:38
  - 问题:订阅到期只更新本地状态，未暂停任何 CraneMail 域名；同时查询订阅仅返回 `active` 状态，导致过期订阅无法续费但其上游邮箱仍继续运行。
  - 证据:`updateMany(... data: { status: 'expired' })` 是调度器唯一副作用；`suspendDomain()` 未被调用。`server/src/db/mail.ts:339-340` 又使用 `where: { userId, status: 'active' }`，而续费路由依赖该查询。
  - 影响:过期用户可长期继续使用上游邮件服务；前端会把过期订阅显示为“无订阅”，用户无法续费并可再次购买，遗留域名则变成不可见但仍工作的免费资源。
  - 修复建议:为到期处理建立可重试的上游暂停任务，并让订阅查询与续费流程明确支持 `expired` 状态及恢复上游域名。

- [M19-02] P1 | 置信度 高 | server/src/routes/mail.ts:775
  - 问题:管理员退款按当前方案标价计算，没有使用用户购买、续费时的实际支付金额。
  - 证据:`const planPrice = Number(subscription.plan.price)`；全额退款直接执行 `refundAmount = planPrice`，剩余价值也用该价格计算；但购买时第 1063-1064 行可能通过优惠码生成更低的 `finalPrice`。
  - 影响:使用优惠码的订单可能被超额退款；管理员修改方案价格后，历史订阅还会按新价格多退或少退，造成直接资金损失和账实不符。
  - 修复建议:持久化每次购买和续费的实付金额及服务区间，退款只能依据不可变的账单流水计算。

- [M19-03] P1 | 置信度 高 | server/src/routes/mail.ts:793
  - 问题:管理员取消订阅先逐个删除上游域名，之后才执行本地退款和删除事务，而且没有取得订阅锁。
  - 证据:第 794-801 行完成远端删除后，第 804 行才启动数据库事务；事务中仅在退款时获取 `USER_BALANCE_LOCK_NAMESPACE`，没有获取 `MAIL_SUBSCRIPTION_LOCK_NAMESPACE`。
  - 影响:中途某个域名删除失败会形成部分删除；数据库事务失败会留下“本地仍有效、上游已删除”的订阅。若与续费并发，用户还可能先被续费扣款，随后订阅被按旧快照删除和退款。
  - 修复建议:取消流程应使用订阅级锁和持久化状态机，将远端删除、退款及最终删除设计为幂等、可恢复步骤。

- [M19-04] P1 | 置信度 高 | server/src/routes/mail.ts:1223
  - 问题:后端允许年付方案按任意 1–12 个月续费，并将年价简单除以 12，绕过了年付周期限制。
  - 证据:`monthlyPrice = Number(plan.price) / 12`，随后按 `monthlyPrice * renewMonths` 收费；统一校验只要求月份在 1–12。前端 `client/src/views/MailView.vue:807-810` 明确写明“按年计费：只能续费1年”并固定显示一年。
  - 影响:用户可绕过前端直接调用 API，以年付折算单价只购买一个月，破坏方案计费规则。
  - 修复建议:后端按 `billingCycle` 限制续费月份，年付方案仅接受完整年度倍数。

- [M19-05] P1 | 置信度 高 | server/src/routes/mail.ts:1501
  - 问题:域名创建成功后，本地域名或管理员账号落库失败时没有执行上游删除补偿。
  - 证据:第 1503 行调用 `craneMailService.createDomain()`，随后第 1508、1518 行直接写数据库；这些本地写入没有补偿 `deleteDomain()` 的异常处理。
  - 影响:事务回滚后 CraneMail 中仍存在域名和管理员邮箱，但本地完全不可见，可能占用域名唯一性和上游容量，并需要人工清理。
  - 修复建议:为远端域名创建建立明确的补偿删除及补偿失败告警/待处理记录。

- [M19-06] P1 | 置信度 中 | server/src/routes/mail.ts:1719
  - 问题:邮箱账号创建的存在性检查、上游创建和本地落库之间没有同域账号锁，现有补偿逻辑在并发请求下可能删除另一个成功请求创建的远端账号。
  - 证据:先执行 `checkMailAccountExists()`，再调用 SmarterMail 的 `user-put`，最后依赖数据库 `@@unique([domainId, username])` 落库；唯一冲突后会无条件调用 `deleteAccount()` 补偿。
  - 影响:两个同用户名请求若都通过前置检查且上游 `user-put` 均成功，其中一个本地唯一冲突会删除共享的远端账号，留下另一条成功本地记录指向不存在的邮箱。
  - 修复建议:对“域名+用户名”获取事务级锁，并使用可证明归属于本次请求的幂等创建标识后再执行补偿。

- [M19-07] P1 | 置信度 高 | server/src/services/cranemail.ts:31
  - 问题:上游地址只在请求前做 DNS 安全检查，实际 `fetch` 没有使用具备连接期 DNS 复核能力的安全 dispatcher，仍存在 DNS rebinding 时间窗口。
  - 证据:代码调用 `assertSafeHttpUrl()` 后直接在第 40 行 `fetch(apiUrl, {...})`，未传 `safeOutboundDispatcher`；`server/src/services/smartermail.ts:31,72` 的两处请求同样如此。
  - 影响:受攻击者控制的上游域名可在校验后重新解析到内网或云元数据地址，使服务端携带 API Key 或认证信息向内部目标发起请求。
  - 修复建议:所有 CraneMail、SmarterMail 请求统一使用 outbound-security 提供的连接期安全 dispatcher。

- [M19-08] P2 | 置信度 高 | client/src/views/MailView.vue:238
  - 问题:续费弹窗无条件使用 AFF 绑定中的折扣率，但后端仅在优惠码仍启用时应用折扣。
  - 证据:前端直接返回 `subscription.value?.affBinding?.affCode?.discountRate || 0`；后端 `server/src/routes/mail.ts:1237` 使用 `if (affBinding && affBinding.affCode.enabled)` 才计算折扣。
  - 影响:优惠码被停用后，弹窗显示的应付金额低于实际扣款金额，用户确认后会被多扣。
  - 修复建议:响应中返回后端计算的当前续费报价，前端不要自行根据绑定记录推导价格。

- [M19-09] P2 | 置信度 高 | server/src/services/smartermail.ts:48
  - 问题:SmarterMail 登录响应直接调用 `response.json()`，没有响应体大小限制。
  - 证据:`const result = await response.json()`；同文件后续普通 API 响应则使用 `readLimitedTextResponse(..., SMARTERMAIL_MAX_RESPONSE_BYTES)` 限制为 1 MB。
  - 影响:异常或恶意上游可返回超大认证响应，造成进程内存突增甚至服务不可用。
  - 修复建议:认证响应也应通过统一的限长读取函数读取后再解析 JSON。

- [M19-10] P2 | 置信度 高 | server/src/routes/mail.ts:1505
  - 问题:多条用户接口把上游原始错误信息直接放入 API 响应。
  - 证据:域名创建返回 ``创建域名失败: ${err.message}``；验证、DNS、账号创建、更新、重置和删除接口也采用相同模式。SmarterMail 第 87 行还会把上游响应正文拼入异常。
  - 影响:用户可能看到上游实现细节、地址、调试内容；若上游回显请求头或凭证，可能进一步泄漏跨租户的上游密钥。
  - 修复建议:客户端只返回固定错误码和安全文案，完整且经过结构化脱敏的上游详情仅写服务端日志。
