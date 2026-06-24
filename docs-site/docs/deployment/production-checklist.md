# 生产验收

## 后台工作台

`/admin/production-proof` 提供只读生产验收工作台，用来集中查看剩余 proof、风险顺序、命令包和证据记录要求。

该页面不会执行真实支付、资源删除、Turnstile 变更或 OTA 回滚；高风险动作仍必须由操作员在维护窗口或测试资源上单独执行。页面中的命令只作为生产服务器执行参考，审计记录仍以脱敏日志、后台页面、数据库摘要、截图编号或工单引用为准。

## 自动检查

```bash
FRONTEND_URL=https://panel.example.com \
ADMIN_FRONTEND_URL=https://admin.example.com \
BACKEND_URL=http://127.0.0.1:3001 \
pnpm verify:split:host
```

```bash
ENV_FILE=/opt/incudal/.env \
FRONTEND_URL=https://panel.example.com \
ADMIN_FRONTEND_URL=https://admin.example.com \
BACKEND_URL=http://127.0.0.1:3001 \
pnpm verify:production
```

```bash
ENV_FILE=/opt/incudal/.env \
PROOF_SINCE_HOURS=24 \
pnpm verify:production-proof-snapshot
```

`verify:production-proof-snapshot` 只读数据库并输出可分享的脱敏 JSON。它不会输出数据库连接串、宿主机 URL、证书路径、安装 Token、Agent 密钥、支付订单号、支付商配置、回调原文、SMTP 密码、Lsky Token、通知渠道配置、实例 root 密码、用户邮箱、IP 或 User-Agent。用它确认支付回调、Agent 上报、实例/流量状态和生命周期日志还缺哪些动作。

## 最终验收

最终验收需要真实业务证据，不能只靠本地测试。

必须补齐：

- 真实支付订单和支付商回调。
- 真实 Incus 创建、启动、停止、重启、重装/重建、删除、清理和终端。
- 真实 Agent 安装、心跳、资源、实例和流量上报。
- 真实 SMTP 发信、Lsky 上传和通知投递；Lsky proof 必须同时记录上传成功和测试附件已删除/清理，不能只记录图片 URL。
- 真实 Turnstile 登录和会话刷新 smoke。
- 备份恢复演练，优先恢复到临时目录或临时库，不能覆盖生产数据。
- 生产响应头和日志敏感信息暴露检查。
- 公网响应头包含 CSP、`X-Frame-Options`、`X-Content-Type-Options`、`Referrer-Policy` 和 `Strict-Transport-Security`。

没有这些 proof refs 时，不应标记为最终生产 100%。
