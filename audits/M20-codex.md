# M20 审计报告
## 结论摘要
托管钱包的基础事务锁和条件扣减已有一定防护，但调度器仍存在全局批次被单个用户锁冲突拖延的问题。最严重的资金风险是销毁退款允许机主仅承担部分扣款却仍向买家全额退款；此外发现手续费预览不一致、用户邮箱暴露及无界查询等问题。

## 发现清单
- [M20-01] P1 | 置信度 高 | server/src/services/hosting-scheduler.ts:55
  - 问题:解冻任务把所有到期记录放进同一事务；任意一个用户的非阻塞余额锁获取失败，就会回滚全部用户的解冻。
  - 证据:`for (const userId ... ) { const locked = await tryAdvisoryTransactionLock(...); if (!locked) { throw new Error(...) } }`，外层仅在第 114 行捕获并记录错误，没有分批或重试。
  - 影响:只要整点时某个机主正在提现、销毁扣款或被管理员调账，其他所有机主本小时的到期收入也无法解冻；持续冲突会造成全局资金长期延迟到账。
  - 修复建议:按用户或有限批次独立事务处理，跳过锁冲突用户并安排短周期重试，避免单个账户阻塞全局。

- [M20-02] P1 | 置信度 中 | server/src/db/billing-operations.ts:1496
  - 问题:托管实例退款扣款允许余额不足时只扣到现有余额，没有检查剩余未扣金额，也没有形成欠款。
  - 证据:`deductFromBalance = Math.min(availableBalance, remainingToDeduct)`；随后直接计算 `totalDeducted` 并返回，未验证 `remainingToDeduct === 0`。调用方已在同一事务中向买家全额增加 `refundAmount`。
  - 影响:机主提前提现并耗尽面板余额后，买家仍可收到全额退款，而机主只承担部分甚至零扣款，差额由平台无账务记录地承担。
  - 修复建议:退款事务必须保证机主全额扣款，或将未扣差额原子记入明确的欠款/负余额账本。

- [M20-03] P2 | 置信度 高 | client/src/views/HostingWalletView.vue:163
  - 问题:前端预计到账金额与后端手续费舍入顺序不同。
  - 证据:前端直接计算 `amount - amount * feeRateBalance`；后端在 `server/src/routes/hosting.ts:584` 先执行 `feeAmount = Number((amount * feeRate).toFixed(2))`，再计算 `actualAmount = amount - feeAmount`。
  - 影响:部分金额的确认弹窗预计到账与实际入账可能相差 0.01 元，用户看到的手续费、到账额和扣款额还可能出现合计不一致。
  - 修复建议:前后端统一以分为单位或共享同一明确的手续费舍入规则，并限制提现金额最多两位小数。

- [M20-04] P2 | 置信度 高 | server/src/routes/hosting.ts:148
  - 问题:拉黑候选搜索向普通托管功能用户返回其他账户的完整邮箱。
  - 证据:查询允许按 `username`、`email` 模糊匹配，并在 `select` 和响应中直接包含 `email`；准入条件仅要求用户至少拥有一台实例。
  - 影响:符合宽松准入条件的普通用户可通过两字符关键词和重复请求枚举其他活跃账户的邮箱，造成个人信息泄露。
  - 修复建议:候选搜索仅返回用户名和 UID，邮箱应删除或进行不可逆脱敏，并限制可搜索字段。

- [M20-05] P2 | 置信度 高 | server/src/routes/hosting.ts:362
  - 问题:托管日志搜索会先无界查询全部匹配实例，再把所有 ID 放入日志查询的 `IN` 条件。
  - 证据:`prisma.instance.findMany(...)` 没有 `take`、分页或数量上限，随后执行 `matchedInstances.map(i => i.id)` 和 `relatedId: { in: matchedInstanceIds }`。
  - 影响:大型机主搜索常见关键词时会占用大量内存并生成超长 SQL 参数列表，严重时请求超时或超过数据库参数限制。
  - 修复建议:改为数据库关联子查询，或对匹配实例分页并设置严格上限。

- [M20-06] P2 | 置信度 高 | client/src/views/HostingWalletView.vue:312
  - 问题:钱包余额、统计、日志和提现记录加载失败时全部吞错，仅写浏览器控制台。
  - 证据:`loadBalance`、`loadStats`、`loadLogs`、`loadWithdrawals` 的 `catch` 只调用 `console.error`；`onMounted` 的 `Promise.all` 因错误被内部吞掉仍正常结束并关闭加载状态。
  - 影响:接口故障时页面会把缺失数据呈现为零余额或空记录，并禁用提现，用户无法区分“真实为零”和“加载失败”。
  - 修复建议:保留明确的加载失败状态并展示可重试提示，避免用默认零值伪装请求失败。
