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

## 订单接口

- 用户端：`GET /api/orders`、`GET /api/orders/:type/:id`，只能读取当前普通用户自己的充值订单和实例账单。
- 管理端：`GET /api/admin/orders`、`GET /api/admin/orders/:type/:id`，仅管理员可读取全站订单。
- 订单中心聚合 `recharge_records` 与 `instance_billing_records`，不返回支付回调原始 payload、支付渠道配置快照或其他敏感字段。
- 后台订单详情中的手动完成、标记失败和人工调账复用现有充值与余额接口：`POST /api/admin/recharge/orders/:orderNo/complete`、`POST /api/admin/recharge/orders/:orderNo/fail`、`POST /api/balance/admin/:userId/adjust`。
