# 系统架构

PayIncus 是面向 Incus/LXC/KVM 商业交付的主控面板。生产推荐非 Docker、前后台双前端、后端内网监听、Agent 上报节点状态的部署方式。

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
  -> PostgreSQL
  -> Incus 节点 / Agent
  -> 支付、SMTP、Telegram、Lsky、Turnstile
  -> 后台 OTA
```

Redis 服务由一键安装脚本保留，用于部署兼容和后续分布式状态扩展。当前核心持久状态以 PostgreSQL 为准。

## 代码模块

| 模块 | 目录 | 责任 |
| --- | --- | --- |
| 用户端 | `client/src` + `VITE_APP_ENTRY=user` | 用户登录、实例、终端、钱包、工单、通知、礼品卡和自助页面 |
| 管理端 | `client/src/admin` + `VITE_APP_ENTRY=admin` | 管理后台、配置、资源、账务、交付和 OTA |
| 后端 | `server/src` | Fastify API、鉴权、数据库、任务、支付、资源交付和审计 |
| Agent | `agent` | 节点安装、心跳、资源、实例和流量上报 |
| 文档站 | `docs-site/docs` | 公开文档、API 说明和 SDK 示例 |

## 构建产物

| 入口 | 构建目录 | 域名 |
| --- | --- | --- |
| 用户端 | `client/dist/user` | `FRONTEND_URL` |
| 管理端 | `client/dist/admin` | `ADMIN_FRONTEND_URL` |
| 后端 | `server/dist/app.js` | `127.0.0.1:3001` 或内网 API |

`pnpm build` 会先构建两个前端，再运行前端构建产物边界守卫，最后构建后端。

## 数据与任务

- PostgreSQL 保存用户、实例、套餐、账务、支付、礼品卡、工单、通知、日志、Public API/OAuth 和系统更新任务。
- 后端 worker 处理实例任务、恢复任务、备份上传、通知邮件、流量采集和系统维护任务。
- 高风险状态变更必须经过 PayIncus 内部状态机、事务、权限、审计和补偿逻辑；Public API 只能走受控入口。
- 后台 OTA 使用 release artifact 或 Git tag 构建新 release，并原子切换 `/opt/incudal/current`。

## 外部集成

| 集成 | 用途 | 风险边界 |
| --- | --- | --- |
| Incus/Agent | 实例交付、资源和流量状态 | 节点证书、安装 token、root 密码不能暴露到用户端或公开 API |
| 支付提供商 | 充值、回调、对账、退款/调账审批 | 回调原文、密钥和 provider 配置只允许后台脱敏查看 |
| SMTP/Telegram | 邮件和通知 | 通知内容和渠道配置不能泄露密钥 |
| Turnstile | 登录、人机验证和敏感操作保护 | 测试 token 不得用于生产 |
| Lsky | 工单附件和图片存储 | 上传 token 和原始 provider payload 不进入公共响应 |

## 关键生产约束

- `SERVE_STATIC_CLIENT=false`，前端由 Nginx 托管。
- 用户端和后台必须使用不同域名和不同静态目录。
- 两个前端都使用同源 `VITE_API_BASE_URL=/api`。
- Nginx 只把 `/api/` 和 `/api/ws/` 反代到后端。
- `index.html` 不能长期缓存，避免 OTA 后浏览器加载旧入口。
- 支付回调地址使用用户端公网域名，不使用后台域名或内网地址。
- 用户端不能出现后台入口、后台 API 或后台文案。
- 管理端不能出现用户端自助功能入口。

## 验证入口

```bash
pnpm --filter server test:frontend-route-guards
pnpm --filter server test:frontend-dist-boundary-guards
pnpm --filter server test:system-update-guards
pnpm --filter server test:public-api-openapi-guards
```

生产域名还需要执行 `pnpm verify:split:host` 和 `pnpm verify:production`。最终上线证明必须补齐真实支付、真实 Incus/Agent、SMTP/通知、Turnstile 和备份恢复证据。
