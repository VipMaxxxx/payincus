# API Reference

PayIncus 前端、第三方集成和扩展后端都通过受控 API 进入平台。公共 API 使用 `/api/v1`，后台和用户端内部 API 使用同源 `/api`。

```text
https://panel.example.com/api
https://admin.example.com/api
https://panel.example.com/api/v1
```

## Introduction

| 能力 | 基础路径 | 鉴权 | 用途 |
| --- | --- | --- | --- |
| User API | `/api/*` | 用户 JWT / Refresh Cookie | 用户端控制台、订单、实例、工单、钱包 |
| Admin API | `/api/admin/*` | 管理员 JWT / Refresh Cookie | 后台管理、配置、审核、支付、资源 |
| Public API | `/api/v1/*` | `pat_` 或 `poa_` Bearer token | 第三方服务端、扩展后端、自动化集成 |
| Agent API | `/api/agent/*` | Agent 签名和重放保护 | 宿主机心跳、资源、实例、流量上报 |
| WebSocket | `/api/ws/*` | 会话和 ticket | Web terminal |

## Authentication

Public API 接受两类 Bearer token：

- `pat_`：用户创建的 API Token。
- `poa_`：OAuth Provider authorization code 流程换取的 access token。

内部用户端和管理后台不应把网页登录 JWT 当作长期第三方凭据。第三方应用应使用 API Token 或 OAuth Provider。

## Public API Resources

| Resource | Method | Path | Scope |
| --- | --- | --- | --- |
| Current user | `GET` | `/api/v1/me` | `profile:read` |
| Balance | `GET` | `/api/v1/balance` | `balance:read` |
| Balance logs | `GET` | `/api/v1/balance/logs` | `balance:read` |
| Balance adjustment requests | `GET` / `POST` | `/api/v1/balance/adjustment-requests` | `balance:write` |
| Products | `GET` | `/api/v1/products` | `products:read` |
| Services | `GET` | `/api/v1/services` | `services:read` |
| Service actions | `POST` | `/api/v1/services/:id/actions` | `services:operate` |
| Service renew | `POST` | `/api/v1/services/:id/renew` | `services:billing` |
| Orders | `GET` | `/api/v1/orders` | `orders:read` |
| Billing records | `GET` | `/api/v1/billing-records` | `billing:read` |
| Tickets | `GET` / `POST` | `/api/v1/tickets` | `tickets:read` / `tickets:write` |
| Notifications | `GET` / `POST` | `/api/v1/notifications` | `notifications:read` / `notifications:send` |
| Plugin actions | `GET` / `POST` | `/api/v1/plugins/:pluginId/actions/:action` | `plugins:action` |

## WebSocket

终端 WebSocket 走同源 `/api/ws`：

```text
wss://panel.example.com/api/ws/...
wss://admin.example.com/api/ws/...
```

## Permissions

- 用户端接口要求普通用户会话，并校验资源所有权。
- 管理接口要求管理员会话。
- Public API 要求 Bearer token、scope、过期时间、撤销状态和用户状态校验。
- Agent 接口要求签名和重放保护。
- 支付回调要求签名校验和回调来源控制。

## Boundary Rule

前后台分离不替代后端授权。每个路由都必须在后端校验身份、角色、scope、资源归属、幂等、限流和审计规则。
