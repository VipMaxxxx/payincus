# BF-9-12 规格：定时同步上游邮箱实际用量(G-B 同意)

## 裁决
**定时同步上游实际用量**(现本地记录与上游真实用量可能漂移)。

## 现状(codex 只读确认)
邮箱账号/域名的实际磁盘/邮件用量以本地记录为准,不定时向上游(cranemail/smartermail)拉真实用量 → 台账与实际漂移。

## 修法(只改 services/cranemail.ts + services/smartermail.ts + 必要调度器 + 守卫;不改 schema/package;不碰 plugins(并行))
1. 先只读:cranemail/smartermail 是否已有拉用量接口、现有邮件相关调度器(billing-scheduler 等注册处)、用量字段存哪。
2. **定时同步**:增/复用一个**低频调度任务**(如每日/每数小时),对活跃邮箱订阅从上游拉**实际磁盘/邮件用量**并更新本地台账;失败容错(单账号失败不影响其它,记日志),外呼走 outbound-security(FX-003/056)。
3. 与现有调度器注册方式一致(startXxxScheduler),幂等、无重复注册(参考 scheduler-startup-idempotency)。

## 加守卫
`test:integration-health-guards` 或邮件相关守卫追加:定时同步上游用量任务存在、失败容错、外呼安全。不改 package.json。

## 不许动
不碰 plugins(并行)。不改 schema/package。不 commit。

## 验收
type-check 通过;`test:scheduler-startup-idempotency`、`test:mail-account-quota-guards`、相关邮件守卫通过。交付一段话:调度频率、拉用量+容错、外呼安全、守卫结果。
