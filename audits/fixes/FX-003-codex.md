FX-003 已按规格完成，未改 `app.ts`，未 commit/push/发版，也未调整任何外呼业务参数。

### 实现

- 在 [outbound-security.ts](C:/Users/Administrator/Desktop/payinces/server/src/lib/outbound-security.ts:193) 新增 `safeFetch`：
  - 请求前调用 `assertSafeHttpUrl`
  - 连接时使用 `safeOutboundDispatcher`
  - 原样透传请求配置

迁移的调用点：

- [epay.ts](C:/Users/Administrator/Desktop/payinces/server/src/lib/epay.ts:205)：`EpayCoreV1.queryOrder`
- [heleket.ts](C:/Users/Administrator/Desktop/payinces/server/src/lib/heleket.ts:310)：`heleketRequest`
- [lottery-notifier.ts](C:/Users/Administrator/Desktop/payinces/server/src/lib/lottery-notifier.ts:200)：`sendDiscord`、`sendWebhook`
- [notifier.ts](C:/Users/Administrator/Desktop/payinces/server/src/lib/notifier.ts:1328)：`sendDiscord`、`sendWebhook`
- [traffic-notifier.ts](C:/Users/Administrator/Desktop/payinces/server/src/services/traffic-notifier.ts:278)：`sendDiscord`
- [system-monitor.ts](C:/Users/Administrator/Desktop/payinces/server/src/services/system-monitor.ts:152)：`sendAlert`
- [lsky.ts](C:/Users/Administrator/Desktop/payinces/server/src/lib/lsky.ts:210)：默认存储查询、图片上传、图片删除
- [plugin-market-submission-scan.ts](C:/Users/Administrator/Desktop/payinces/server/src/lib/plugin-market-submission-scan.ts:80)：插件包下载
- [theme-market-submission-scan.ts](C:/Users/Administrator/Desktop/payinces/server/src/lib/theme-market-submission-scan.ts:77)：主题包下载
- [tickets.ts](C:/Users/Administrator/Desktop/payinces/server/src/routes/tickets.ts:382)：工单附件图片代理
- [cranemail.ts](C:/Users/Administrator/Desktop/payinces/server/src/services/cranemail.ts:40)：`callApi`
- [smartermail.ts](C:/Users/Administrator/Desktop/payinces/server/src/services/smartermail.ts:31)：`getAuthToken`、`callApi`

CraneMail/SmarterMail 当前实际使用全局 `fetch`，因此属于本次 undici 覆盖范围。

已有连接期保护的 Antom、插件运行时、管理端 Lsky 探测保持不动。固定 `api.telegram.org` 调用不属于“动态 URL 校验后 fetch”迁移范围。

### 守卫

新增 [test-safe-outbound-fetch-guards.ts](C:/Users/Administrator/Desktop/payinces/server/scripts/test-safe-outbound-fetch-guards.ts)，并接入：

- [server/package.json](C:/Users/Administrator/Desktop/payinces/server/package.json:184)
- [根 test 链](C:/Users/Administrator/Desktop/payinces/package.json:39)

最终验证全部通过：

- `pnpm --filter server type-check`
- `test:safe-outbound-fetch-guards`
- `test:payment-provider-outbound-guard`
- `test:storage-outbound-guards`
- `test:mail-source-outbound-guard`
- `test:oauth-outbound-guard`
- `test:notification-fetch-guards`
- `test:ticket-image-security`
- `test:system-monitor-webhook-guard`
- `test:plugin-market-submission-scan-guards`
- `test:theme-system-guards`
- `git diff --check`

### 非-fetch 后续治理项

本次未硬改：

- Nodemailer SMTP：`server/src/lib/mailer.ts`
- FTP：`FtpProvider`
- SFTP：`SftpProvider`
- WebDAV 客户端：`WebDavProvider`
- AWS SDK S3 客户端：`S3Provider`

这些客户端不能直接使用 undici dispatcher，需要各自设计连接期 DNS/IP 复校方案。

未进行真实外部请求验证，避免向支付、邮件、Webhook 或存储服务产生实际流量。工作树原本已有其他未提交改动，均未处理；`app.ts` 未被本任务修改。
