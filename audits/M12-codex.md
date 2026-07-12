# M12 审计报告
## 结论摘要
秒杀库存申领和礼品卡兑换的核心事务具备 advisory lock 与条件更新保护，但管理侧变更、交付状态回写及资源兑换仍存在并发缺口。最严重的问题是同一实例并发兑换不同资源码会消耗两张码却只生效一次，以及可重复使用的完整兑换码被写入日志。

## 发现清单
- [M12-01] P1 | 置信度 高 | server/src/routes/checkin.ts:237
  - 问题:系统兑换仅按兑换码和批次加锁，没有在读取实例资源、调用 Incus 前锁定目标实例；不同兑换码并发应用到同一实例会发生丢失更新。
  - 证据:`withSystemRedeemLocks()` 的锁键只有 `redeem-code:${redeemCodeId}` 和批次用户键；锁内先读取 `currentInstance`，再以旧值计算 `const newCpu = currentInstance.cpu + codeValue` 并调用 `patchInstanceResources`。实例 advisory lock 直到 `applySystemRedeemCodeToInstance()` 内才获取（`server/src/db/redeem-codes.ts:354-356`），此时外部资源修改和新值计算已经完成。
  - 影响:两张不同兑换码同时兑换到同一实例时，两次请求可能写入相同目标值；两张码均被消耗、宿主用量累计两次，但实例实际只增加一次资源。
  - 修复建议:将实例级分布式锁覆盖“重新读取实例—Incus 修改—数据库提交”的整个流程，并在持锁后重新计算目标资源值。

- [M12-02] P1 | 置信度 高 | server/src/routes/checkin.ts:370
  - 问题:完整系统兑换码被写入成功日志和资源池日志，而单码允许最多使用 1000 次，日志中的兑换码可能仍是有效的 bearer credential。
  - 证据:成功日志直接插入 ``Redeemed system code ${trimmedCode}``，随后又将 ``系统兑换码 ${trimmedCode} 应用到...`` 传给 `logSystemRedeemToInstance()`；失败路径在第 450 行也记录完整 `trimmedCode`。
  - 影响:任何能够读取业务日志或资源池日志的人都可能取得并重复使用尚未耗尽的兑换码。
  - 修复建议:所有日志仅记录兑换码 ID 或统一掩码后的首尾片段，禁止持久化完整码值。

- [M12-03] P1 | 置信度 高 | server/src/services/flash-sales.ts:523
  - 问题:管理员调库存时在事务外读取并校验 `soldCount + reservedCount`，写入事务既未取得秒杀商品锁，也没有条件更新，能够与抢购申领竞态。
  - 证据:第 527–530 行先读取 `item` 并校验库存下限，第 532–536 行随后无条件写入 `totalStock`；抢购路径则在第 732 行取得 `FLASH_SALE_ITEM_LOCK_NAMESPACE` 后递增 `soldCount`，两条路径没有共同串行化机制。`updateFlashSaleItemConfig()` 第 576–593 行存在相同模式。
  - 影响:管理员校验通过后若并发成交，最终可能出现 `totalStock < soldCount + reservedCount`，造成负库存语义和错误的在售状态。
  - 修复建议:库存调整和商品配置更新应在同一事务中取得商品 advisory lock，并基于锁后最新计数重新校验后写入。

- [M12-04] P1 | 置信度 高 | server/src/services/flash-sales.ts:793
  - 问题:秒杀交付成功与失败回写不是原子状态迁移，并发或重复回调会重复修改统计，甚至互相覆盖最终状态。
  - 证据:`markFlashSaleDelivered()` 先 `findFirst` 查找 `paid/delivering`，之后按纯 `id` 更新并递增 `deliveredCount`；`markFlashSaleFailed()` 第 816–837 行采用相同的先读后写方式，并递增 `failedCount`、递减 `soldCount`，更新条件没有携带原状态。
  - 影响:重复成功回调会重复增加交付数；成功与失败回调竞态时，订单可能先交付后被改成失败或退款，同时出现交付数、失败数重复累计及 `soldCount` 错减。
  - 修复建议:使用带当前状态条件的 `updateMany` 或状态机式原子迁移，仅在成功抢占状态的一方更新商品统计。

- [M12-05] P1 | 置信度 中 | server/src/services/flash-sales.ts:720
  - 问题:秒杀资格检查得到的价格与最终库存申领之间存在价格 TOCTOU；申领事务重读商品后没有验证传入成交金额是否仍符合当前秒杀价。
  - 证据:资格检查第 705–716 行返回当时的 `flashPrice`；申领函数接收调用方传入的 `amount`，虽然第 734–740 行重新读取商品，却在第 767–780 行直接保存 `amount: input.amount`，未比较当前 `item.flashPrice`。管理员可在第 582–592 行并发更新价格且不取得商品锁。
  - 影响:结算期间管理员修改秒杀价时，用户可能按旧价扣款并占用新价格配置下的库存，导致少收或多收。
  - 修复建议:价格变更与申领共用商品锁，并在最终扣款事务内绑定、验证明确的价格版本或快照。

- [M12-06] P2 | 置信度 高 | server/src/routes/gift-cards.ts:428
  - 问题:未识别异常的原始错误消息被直接放入 500 响应，可能暴露 Prisma、数据库约束或内部实现信息。
  - 证据:异常被转换为 `msg` 后直接执行 `apiError(ErrorCode.INTERNAL_ERROR, msg)`；`apiError()` 会将第二参数原样放入响应的 `details`。同文件第 188–190、264–266、485–489 行及 `server/src/routes/redeem-codes.ts:341-350` 等路径也采用相同处理。
  - 影响:用户可能看到表名、字段名、约束名或其他内部错误细节，为攻击者提供系统结构信息，同时产生不友好的错误提示。
  - 修复建议:服务端记录脱敏后的详细异常，客户端 500 响应仅返回固定错误码和通用文案。

- [M12-07] P3 | 置信度 高 | client/src/views/FlashSalesView.vue:43
  - 问题:秒杀用户页未接入 i18n，大量状态、按钮、标题及错误提示为硬编码中文。
  - 证据:`itemStatus()` 直接返回“未开始”“已暂停”“已抢完”等文本；模板第 99–125、145–177 行和异常处理第 62、74 行同样直接写中文，文件也未使用 `useI18n()`。
  - 影响:切换英文或繁体语言后，该页面仍显示简体中文，且后端原始错误可能混入提示。
  - 修复建议:为秒杀页面补齐三套 locale key，并通过统一错误码映射展示本地化文案。
