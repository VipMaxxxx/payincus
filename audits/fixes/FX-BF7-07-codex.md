已按 BF-7-07 完成：普通转账在 [db/transfers.ts](C:/Users/Administrator/Desktop/payinces/server/src/db/transfers.ts:581) 更新实例所有者时同步置 `autoRenew: false`；过户提交后通过现有 `sendNotification` 机制向接收方发送站内信，提示自动续费已关闭且原系统未重装，需立即重置 SSH 密钥、登录密码等凭证，接受转账和直接推送均已覆盖。守卫保留 FX-067b 受让限制，并新增上述两项断言。

验证结果：

- `pnpm --filter server test:transfer-query-guards`：通过
- `pnpm --filter server type-check`：通过
- `git diff --check`：通过
- 未改 mail、schema、package；未 commit、push 或发版。
