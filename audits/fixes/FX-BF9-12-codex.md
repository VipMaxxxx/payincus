已完成 BF-9-12，未 commit/push/发版。本次新增每日 03:17 邮箱用量同步：[mail-usage-scheduler.ts](C:/Users/Administrator/Desktop/payinces/server/src/services/mail-usage-scheduler.ts:12) 扫描活跃订阅，从 CraneMail 拉域级实际磁盘用量、从 SmarterMail 拉账户 `mailboxSizeUsed`，分别更新 `MailDomain.diskUsedMb` 和 `MailAccount.diskUsedMb`；域、上游和单账户更新均独立容错并记录脱敏日志。外呼复用 [cranemail.ts](C:/Users/Administrator/Desktop/payinces/server/src/services/cranemail.ts:202) 与 [smartermail.ts](C:/Users/Administrator/Desktop/payinces/server/src/services/smartermail.ts:262) 的 `assertSafeHttpUrl + safeFetch + timeout + manual redirect` 安全链路。调度器具备启动幂等和运行防重入，并已在 [app.ts](C:/Users/Administrator/Desktop/payinces/server/src/app.ts:787) 注册；守卫追加至邮箱配额及调度幂等测试。

验证结果：

- server type-check：通过
- `test:scheduler-startup-idempotency`：通过
- `test:mail-account-quota-guards`：通过
- `test:mail-source-outbound-guard`：通过
- 其余邮箱源、域生命周期、取消、续费等 8 项守卫：通过
- `test:mail-account-create-compensation`：失败，原因是并行工作区既有 `routes/mail.ts` 改动与该守卫断言不一致；本任务未修改相关路由，未越界处理
- 未进行真实上游联调，避免使用生产凭证

本次未修改 plugins、schema 或 package；这些文件在工作区原本已有并行未提交改动。
