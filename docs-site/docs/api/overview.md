# API 概览

PayIncus 前端通过同源 `/api` 调用后端。

```text
https://panel.example.com/api
https://admin.example.com/api
```

两个域名的 `/api` 都由 Nginx 反代到同一个后端。

## WebSocket

终端 WebSocket 走同源 `/api/ws`：

```text
wss://panel.example.com/api/ws/...
wss://admin.example.com/api/ws/...
```

## 权限

- 用户端接口要求普通用户会话。
- 管理接口要求管理员会话。
- Agent 接口要求 Agent 签名和重放保护。
- 支付回调要求签名校验和回调来源控制。
