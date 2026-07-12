# M08 审计报告

## 结论摘要
M08 钱路总体工程质量很高：核心资金不变量（并发双花、余额转负、转给自己、价格篡改、托管款守恒、越权）基本都用 PG advisory 锁 + 条件式 `updateMany({ where: { balance/amount: { gte } } })` + 单事务原子性正确钉死,且有守卫测试反向约束。**未发现 P0/P1 级可直接盗取或凭空造钱的漏洞。** 发现集中在"状态变更与退款/交割不在同一事务、缺补偿重试"以及交付 worker 依赖内存去重的竞态防御深度上,均为 P2/P3。

## 发现清单

- [M08-01] P2 | 置信度 高 | server/src/routes/transfers.ts:763-810(拒绝)、842-888(取消) ; server/src/db/transfers.ts:345-406(refundTransferFee)
  - 问题：转移手续费退款与"拒绝/取消"状态翻转不在同一事务,且退款失败无重试/补偿。updateMany 先把转移原子改为 rejected/cancelled 并提交,随后另起事务调 refundTransferFee;失败仅 console.error。
  - 证据：refundTransferFee 拿不到 USER_BALANCE_LOCK(并发)或异常时 return {success:false};调用处 `if (!refundResult.success) console.error(...)` 后照常返回"已拒绝/已取消"。状态已落终态,无任务补退。
  - 影响：transfer_fee>0 时遇余额锁冲突或进程崩溃,用户被扣手续费永久丢失,账目对不平(钱少给用户)。
  - 修复建议：把退款并入状态翻转同一事务,或引入幂等退款补偿扫描任务。

- [M08-02] P3 | 置信度 中 | server/src/workers/exchangeDeliveryWorker.ts:357-382、779-812、814-844
  - 问题：交割 finalize 的 Incus 副作用在事务/锁之外,PROCESSING 任务重入只靠单进程内存去重(runningTaskIds);finalizeDelivery 的 stopInstance/renameIncusInstance 在 prisma.$transaction 之前,未对 order/task 加 advisory 锁。
  - 影响：单进程部署可控;一旦多进程运行 worker,同一任务可能被两进程同时 finalize,触发对同一实例的竞态 Incus 重命名与交割异常。防御深度不足。
  - 修复建议：finalize 前对 order/task 取 advisory 事务锁(或用 DB 状态抢占 PROCESSING)。

- [M08-03] P3 | 置信度 低 | server/src/db/transfers.ts:557-611(executeTransfer)、66-77(cleanupTimeoutTransfers) ; server/src/routes/transfers.ts:493-502、952-961(rollbackToPending)
  - 问题：executeTransfer 事务内无条件把实例改所有者并置 accepted,不复检当前状态;rollbackToPending 也无条件写回 pending;配合 30 分钟超时把 processing 重置 pending,极慢交割下可能重复执行或状态与所有权错位。
  - 影响：非资金损失,但可能"实例已过户但转移记录被回写 pending"的状态不一致;触发前提(Incus 重命名挂起>30 分钟)极端罕见。
  - 修复建议：executeTransfer/回滚加 where {status:'processing'} 条件式更新,超时清理避开正在过户的记录。

- [M08-04] P3 | 置信度 低 | server/src/services/exchange.ts:95-107、182-185、523-537 ; server/src/routes/admin-exchange.ts:52-63
  - 问题：全链路金额用 JS number(Decimal→toNumber→算术→toFixed(2))而非始终 Decimal 运算,精度隐患。
  - 影响：受 maxMoney 上限、两位小数正则与 toFixed(2) 约束,未发现可利用的分币泄漏或造钱点;仅架构层精度风险。
  - 修复建议：资金计算尽量在 Prisma.Decimal 层完成。

补充:转账创建扣费、交易所购买锁挂牌+扣款入托管、托管放款/退款/提现冻结解冻、争议放款/退款等关键路径均已用 advisory 锁+条件式扣减+单事务回滚正确保证原子性与守恒,公开挂牌经 sanitizePublicInstanceSnapshot 匿名化,越权由后端条件式校验兜底,未见问题。前端购买只发 listingId,价格由服务端派生(无客户端可信金额)。
