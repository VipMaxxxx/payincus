# M16 审计报告
## 结论摘要
游戏化模块的签到去重、抽奖扣点/库存/发奖事务以及 VIP 领取并发锁整体设计较稳健。最严重的问题是删除配置会级联删除中奖或领取历史，可能造成奖励重复领取；此外奖池概率缺少总和约束，会直接破坏抽奖公平性。

## 发现清单
- [M16-01] P1 | 置信度 高 | server/prisma/schema.prisma:4175
  - 问题:删除 VIP 奖励会级联删除该奖励的全部用户领取记录，删除后重建奖励可让同一用户再次领取。
  - 证据:`reward VipBenefitReward @relation(..., onDelete: Cascade)`；管理接口直接执行 `prisma.vipBenefitReward.delete`，领取资格又仅根据当前 `vipBenefitClaim` 数量判断。
  - 影响:管理员调整或误删奖励配置后，余额、积分等奖励的历史幂等凭据消失；重建奖励时已领取用户可能再次入账。
  - 修复建议:领取历史应使用快照并禁止级联删除，奖励配置改为停用或软删除。

- [M16-02] P1 | 置信度 高 | server/prisma/schema.prisma:4689
  - 问题:删除抽奖活动或奖品会级联删除历史中奖记录。
  - 证据:`lottery ... onDelete: Cascade`、`prize ... onDelete: Cascade`；管理端允许直接删除活动和奖品，而 `totalDraws` 又通过 `lotteryRecord.count` 实时统计。
  - 影响:用户中奖记录、待发放实例奖品、通知状态和抽奖统计会永久消失，库存及概率审计也无法追溯。
  - 修复建议:已有抽奖记录的活动和奖品只允许停用，历史记录应保留奖品快照并使用限制删除或软删除。

- [M16-03] P1 | 置信度 高 | server/src/routes/admin-entertainment.ts:446；server/src/db/lottery.ts:503
  - 问题:只校验单个奖品概率位于 0～100，没有校验整个奖池概率总和；选择算法达到 100 后，后续奖品实际永远不会命中。
  - 证据:保存时仅判断 `parsedProbability < 0 || parsedProbability > 100`；抽取时执行 `random = Math.random() * 100`，随后按奖品顺序累加 `cumulative` 并在 `random < cumulative` 时立即返回。
  - 影响:概率总和超过 100% 时，列表靠后的奖品概率会被截断甚至归零，但用户界面仍展示管理员填写的概率，构成明显的公平性与披露不一致。
  - 修复建议:启用奖池前原子校验总概率不超过 100%，并明确校验剩余概率对应唯一的 `nothing` 奖品。

- [M16-04] P2 | 置信度 高 | client/src/views/admin/EntertainmentView.vue:400
  - 问题:奖池保存不是原子操作，前端先逐个删除旧奖品，再逐个更新或创建新奖品，任一中途失败都会留下半成品配置。
  - 证据:代码先循环调用 `adminDeletePrize`，随后另一循环依次 `await adminUpdatePrize/adminCreatePrize`，没有批量事务接口或失败回滚。
  - 影响:网络中断或某个奖品校验失败时，线上活动可能丢失部分奖品、概率总和异常；删除旧奖品还会触发历史中奖记录级联删除。
  - 修复建议:提供后端“整池替换”事务接口，一次校验概率、库存和奖品数据后统一提交。

- [M16-05] P2 | 置信度 高 | server/src/services/vip-benefits.ts:698；server/src/db/checkin.ts:344；server/src/db/lottery.ts:588
  - 问题:VIP 发积分、签到和抽奖扣点没有完整复用积分层的余额及累计计数上限校验。
  - 证据:VIP 直接递增 `points`、`totalEarned`；签到只检查 `currentPoints > 2_147_483_647`，未检查 `totalEarned`；抽奖直接递增 `totalSpent`。这些字段在 Prisma 中均为 32 位 `Int`。
  - 影响:累计获得或消耗接近上限后，即使当前余额仍合法，签到、VIP 奖励领取或抽奖也会因数据库整数溢出持续失败并返回 500。
  - 修复建议:所有积分变动统一走共享的安全 mutation helper，同时检查当前余额、`totalEarned` 和 `totalSpent` 上限。

- [M16-06] P2 | 置信度 高 | server/src/routes/entertainment.ts:506
  - 问题:十连抽将捕获到的内部异常文本直接返回给用户。
  - 证据:非重试异常和重试耗尽路径均设置 `stopReason: lastError?.message`；该值可能来自 Prisma、PostgreSQL或余额锁异常。
  - 影响:用户可能看到数据库约束、事务或内部实现信息；前端又会直接通过 toast/弹窗展示 `stopReason`。
  - 修复建议:响应只返回稳定错误码和本地化通用文案，详细异常仅写入经过脱敏的服务端日志。

- [M16-07] P2 | 置信度 高 | server/src/routes/checkin.ts:127
  - 问题:签到未知异常被原样写入响应。
  - 证据:捕获异常后执行 `reply.code(500).send(apiError(ErrorCode.INTERNAL_ERROR, errorMessage))`，其中 `errorMessage` 是原始异常的 `message`。
  - 影响:积分溢出、数据库故障等异常可能向用户泄露内部错误详情，且用户得到的不是稳定、友好的签到错误。
  - 修复建议:未知异常统一返回固定内部错误文案，原始错误仅在服务端脱敏记录。

- [M16-08] P2 | 置信度 高 | server/src/routes/entertainment.ts:300；server/src/lib/lottery-notifier.ts:131
  - 问题:高价值中奖通知通过进程内 `setImmediate` 脱离请求发送，失败仅记录日志，没有持久化重试机制。
  - 证据:余额或实例中奖后调用 `setImmediate(() => sendLotteryWinNotification(...))`；通知函数捕获全部异常后仅 `console.error`。代码中 `notificationSent` 只存在成功标记，没有扫描未发送记录的补偿任务。
  - 影响:事务提交后若进程退出、网络超时或 webhook 临时故障，管理员可能永久收不到实例待发放或余额中奖通知。
  - 修复建议:在抽奖事务内写入通知 outbox，由持久化 worker 按 `notificationSent=false` 幂等重试。
