# 生产验收

## 自动检查

```bash
FRONTEND_URL=https://pay.payincus.com \
ADMIN_FRONTEND_URL=https://admin.payincus.com \
BACKEND_URL=http://127.0.0.1:3001 \
pnpm verify:split:host
```

```bash
ENV_FILE=/opt/incudal/.env \
FRONTEND_URL=https://pay.payincus.com \
ADMIN_FRONTEND_URL=https://admin.payincus.com \
BACKEND_URL=http://127.0.0.1:3001 \
pnpm verify:production
```

## 最终验收

最终验收需要真实业务证据，不能只靠本地测试。

必须补齐：

- 真实支付订单和支付商回调。
- 真实 Incus 创建、启动、停止、重装、删除和终端。
- 真实 Agent 安装、心跳、资源、实例和流量上报。
- 真实 SMTP 发信、Lsky 上传和通知投递。
- 生产响应头和日志敏感信息暴露检查。
- 公网响应头包含 CSP、`X-Frame-Options`、`X-Content-Type-Options`、`Referrer-Policy` 和 `Strict-Transport-Security`。

没有这些 proof refs 时，不应标记为最终生产 100%。
