# 系统架构

PayIncus 推荐使用非 Docker、前后台双前端分离部署。当前代码不是一个前端入口里区分用户和后台，而是两个独立 Vite entry、两个构建目录、两个公网域名，共用同一个后端 API。

## 标准拓扑

```text
用户浏览器
  -> https://panel.example.com
  -> Nginx 静态用户端：/opt/incudal/current/client/dist/user
  -> /api 和 /api/ws 反代到后端 127.0.0.1:3001 或内网 IP:3001

管理员浏览器
  -> https://admin.example.com
  -> Nginx 静态管理端：/opt/incudal/current/client/dist/admin
  -> /api 和 /api/ws 反代到同一个后端 127.0.0.1:3001 或内网 IP:3001

后端 Node API
  -> PostgreSQL / Redis / Incus 节点 / Agent
```

## 构建产物

| 入口 | Vite entry | 构建目录 | 域名 |
| --- | --- | --- | --- |
| 用户端 | `VITE_APP_ENTRY=user` | `client/dist/user` | `FRONTEND_URL` |
| 管理端 | `VITE_APP_ENTRY=admin` | `client/dist/admin` | `ADMIN_FRONTEND_URL` |
| 后端 | `server/dist/app.js` | `server/dist` | `127.0.0.1:3001` 或内网 API |

## 关键约束

- 生产设置 `SERVE_STATIC_CLIENT=false`，后端不直接托管前端静态文件。
- 两个前端都使用 `VITE_API_BASE_URL=/api`。
- Nginx 只把 `/api/` 和 `/api/ws/` 反代到后端。
- 支付回调地址使用用户端公网域名，不使用后台域名。
- 用户端不能出现后台入口、后台 API 或后台跳转。
- 管理端不能出现用户端自助功能入口。
