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
  -> PostgreSQL / Incus 节点 / Agent
  -> Redis 服务由一键安装脚本保留，用于兼容部署和后续分布式状态扩展
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
- Nginx 应让 `index.html` 使用 `expires epoch`，避免 OTA 后浏览器继续加载旧入口。
- Nginx 应让 `/assets/` 使用独立静态规则和长期缓存，因为文件名带 hash，更新后会自动换新路径。
- 支付回调地址使用用户端公网域名，不使用后台域名。
- 用户端不能出现后台入口、后台 API 或后台跳转。
- 管理端不能出现用户端自助功能入口。

## 数据与运行态

- PostgreSQL 是当前核心持久化来源，保存用户、实例、账务、配置、日志、系统更新任务、扩展、主题和 Public API/OAuth 数据。
- 后端 worker 负责实例任务、恢复任务、备份上传、通知邮件和扩展事件等队列处理；这些任务的可恢复状态落在数据库。
- 一键安装脚本仍会安装并保护 Redis 服务，`REDIS_URL` 会写入 `.env`，systemd 模板也会等待 `redis-server.service`。当前核心业务不依赖 Redis 客户端完成持久状态，Redis 主要作为部署兼容和后续分布式缓存/会话/短期 token 扩展预留。
- Incus hosts 提供 LXC/KVM 资源，Agent 上报宿主机资源和实例状态。
