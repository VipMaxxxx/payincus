<h1 align="center"><img src="./client/public/incudal_logo.webp" width="100" align="absmiddle" alt="Incudal logo"> Incudal</h1>

<p align="center">基于 Incus 的 LXC / KVM NAT VPS 销售、交付与管理面板。</p>

## 项目简介

Incudal 基于 Incus 的 NAT VPS 销售与管理面板。
项目支持 LXC / KVM 实例、套餐与镜像管理、账务计费、节点托管、用户后台、管理员后台以及宿主机 Agent。

> 演示站：https://demo.incudal.com<br/>
> <strong>仅供学习与参考，本项目存在诸多不完善之处。有任何问题建议 Fork 后使用 AI 解决。</strong><br/>

## 主要功能

- 实例交付：基于 Incus 创建和管理 LXC / KVM 实例，支持 NAT 网络、系统镜像、套餐资源和节点绑定。
- 平台运营：提供用户端与管理员后台，覆盖用户、套餐、镜像、节点、工单、公告、日志和系统配置等管理流程。
- 计费与权益：支持余额、充值、消费记录、托管收益、支付渠道、积分、VIP 等级和会员福利。
- 节点与扩展：通过宿主机 Agent 上报资源与状态，并支持托管节点、反代建站、邮箱服务等扩展能力。

## 目录结构

```text
client/                 Vue 3 + Vite 前端
server/                 Fastify + Prisma 后端
agent/                  Go 宿主机 Agent
server/prisma/          数据库 schema 与 migrations
server/templates/       安装脚本、邮件等模板
.github/workflows/      CI、Release 和 Agent Release 工作流
scripts/                本地开发和检查脚本
```

## 搭建教程

当前部署使用主机进程方式。生产环境建议准备 Node.js 22、PostgreSQL 16、Redis 7、Nginx 和 systemd。

Agent 正式二进制不存放在面板仓库内，面板运行时会从 GitHub Release 查询和代理下载。如部署在私有仓库或 fork，可按需配置：

```env
INCUDAL_AGENT_RELEASE_REPOSITORY=VipMaxxxx/payincus
INCUDAL_AGENT_RELEASE_TOKEN=github_pat_xxx
```

如果还没有发布 GitHub Agent Release，也可以把 `agent/scripts/build-release.sh` 生成的 `manifest.json` 和双架构二进制放到服务器本地目录，并配置：

```env
INCUDAL_AGENT_RELEASE_DIR=/opt/incudal/agent-release
```

### 生产部署：内网前后端分离

推荐架构：

```text
浏览器 -> https://panel.example.com -> 前端 Nginx
前端 Nginx -> http://10.0.0.12:3001/api -> 后端 Node API
后端 Node API -> PostgreSQL / Redis / Incus 节点
```

浏览器永远只访问前端域名；后端只监听内网 IP 或 `127.0.0.1`，由前端 Nginx 转发 `/api/` 和 `/api/ws/`。这种方式更适合 Cookie、OAuth、支付回调和 WebSocket。

后端 `.env` 推荐配置：

```env
NODE_ENV=production
HOST=10.0.0.12
PORT=3001
TRUST_PROXY=true
SERVE_STATIC_CLIENT=false

DATABASE_URL=postgresql://incudal:change_me@127.0.0.1:5432/incudal
REDIS_URL=redis://:change_me@127.0.0.1:6379

FRONTEND_URL=https://panel.example.com
SITE_URL=https://panel.example.com
PAYMENT_CALLBACK_BASE_URL=https://panel.example.com
VITE_API_BASE_URL=/api
COOKIE_SAME_SITE=
COOKIE_SECURE=
COOKIE_DOMAIN=

# 每一项都单独生成，例如：openssl rand -base64 48
JWT_SECRET=change_me_generate_with_openssl_rand_base64_48
COOKIE_SECRET=change_me_generate_with_openssl_rand_base64_48
ENCRYPTION_KEY=change_me_generate_with_openssl_rand_base64_48
ADMIN_PASSWORD=change_me_admin_password
```

如果前端和后端在同一台机器，把 `HOST` 改成 `127.0.0.1`，Nginx 也反代到 `http://127.0.0.1:3001` 即可。如果前端和后端在两台内网机器，后端防火墙只放行前端机器访问 `3001` 端口。

生产环境不要设置 `RESET_DATABASE`。如果确实要清空生产库，后端会要求同时设置 `ALLOW_PRODUCTION_DATABASE_RESET=RESET_PRODUCTION_DATABASE`，否则启动会直接失败并拒绝清库。

`TRUST_PROXY=true` 只应在后端端口仅允许可信 Nginx/内网代理访问时开启。它用于让后端读取 `X-Forwarded-For`，从而保证支付回调 IP 白名单、限流、Turnstile 等逻辑拿到真实客户端 IP；如果后端端口暴露到公网，必须关闭或先收紧防火墙。

默认推荐前端同域访问并通过 Nginx 反代 `/api`，HTTPS 生产环境下 Cookie 相关配置留空即可。若只是内网 HTTP 验证且没有 TLS，需设置 `COOKIE_SECURE=false`，否则浏览器不会保存或发送 refresh cookie。若前端和 API 使用不同站点并需要跨站刷新登录态，设置 `COOKIE_SAME_SITE=none`、`COOKIE_SECURE=true`；只有需要跨子域共享 Cookie 时才设置 `COOKIE_DOMAIN=.example.com`。

安装依赖、迁移数据库并构建：

```bash
corepack enable
corepack prepare pnpm@9.14.2 --activate
pnpm install --frozen-lockfile

pnpm --filter server exec prisma generate
pnpm --filter server exec prisma migrate deploy
pnpm build

NODE_ENV=production SERVE_STATIC_CLIENT=false HOST=10.0.0.12 PORT=3001 node server/dist/app.js
```

生产环境建议使用 systemd 托管后端，可复制模板后调整路径和用户：

```bash
sudo cp deploy/incudal-backend.service.example /etc/systemd/system/incudal-backend.service
sudo systemctl daemon-reload
sudo systemctl enable --now incudal-backend
sudo journalctl -u incudal-backend -f
```

构建前端时保持同域反代：

```bash
VITE_API_BASE_URL=/api pnpm --filter client build
```

然后把 `client/dist` 放到前端 Nginx 服务器。Nginx 模板：

```text
deploy/nginx-split-intranet.conf.example
```

需要替换：

- `panel.example.com`：你的前端域名
- `/opt/incudal/client/dist`：前端构建产物目录
- `10.0.0.12:3001`：后端内网 IP 和端口

验证内网前后端分离部署：

```bash
FRONTEND_URL=https://panel.example.com \
BACKEND_URL=http://10.0.0.12:3001 \
pnpm verify:split:host
```

上线前建议再跑生产预检。该检查会读取当前环境变量或 `ENV_FILE` 指定的 `.env`，确认生产分离部署关键项一致：`NODE_ENV=production`、`PORT=3001`、`SERVE_STATIC_CLIENT=false`、`VITE_API_BASE_URL=/api`、公网 HTTPS `FRONTEND_URL`/`SITE_URL`/`PAYMENT_CALLBACK_BASE_URL`、`TRUST_PROXY=true`、`PAYMENT_CALLBACK_SKIP_IP_WHITELIST=false`、支付回调 IP 白名单格式，以及 Agent Release 或自定义 Agent 二进制校验配置。默认还会执行数据库配置预检、`verify:split:host`，并检查 `/api/agent/manifest.json` 可用性：

```bash
ENV_FILE=/opt/incudal/.env \
FRONTEND_URL=https://panel.example.com \
BACKEND_URL=http://10.0.0.12:3001 \
pnpm verify:production
```

数据库配置预检会检查 PostgreSQL 可连接、活跃支付渠道配置、SMTP 邮件配置、Lsky 工单图片配置，以及资源交付前置条件（在线节点、节点安装/API/Agent 心跳/资源上报状态、运行实例流量基线、可见镜像、公开启用套餐和套餐绑定节点）。若你暂时只想检查 `.env`，可跳过数据库和线上 HTTP 检查：

```bash
ENV_FILE=/opt/incudal/.env RUN_LIVE_CHECKS=0 pnpm verify:production
```

最终上线验收可使用严格聚合入口。该入口会强制开启生产预检、登录/权限 smoke、Agent release endpoint smoke、生产响应头/日志暴露检查和 `REQUIRE_LIVE_PROOF_REFS=1`；伪造回调、Agent 心跳 smoke 会创建临时数据，需显式开启。下面的 evidence 占位文字必须替换成真实工单、监控、日志或验收记录引用，否则命令会失败：

```bash
ENV_FILE=/opt/incudal/.env \
FRONTEND_URL=https://panel.example.com \
BACKEND_URL=http://10.0.0.12:3001 \
RUN_SPLIT_AUTH_SMOKE=1 \
SMOKE_ADMIN_PASSWORD='your-admin-password' \
LIVE_ACCEPTANCE_REPORT=/opt/incudal/live-acceptance-report.md \
REQUIRE_LIVE_PROOF_REFS=1 \
ACCEPTED_WARNINGS_OWNER='ops-owner' \
ACCEPTED_WARNINGS_DATE='2026-06-23' \
ACCEPTED_WARNINGS_NOTE='No accepted warnings' \
LIVE_PAYMENT_PROOF_REF='provider order/callback evidence URL or ticket' \
LIVE_INCUS_PROOF_REF='Incus lifecycle evidence URL or ticket' \
LIVE_AGENT_PROOF_REF='Agent install/report evidence URL or ticket' \
LIVE_MAIL_PROOF_REF='SMTP/Lsky/notification evidence URL or ticket' \
LIVE_LOG_HEADER_PROOF_REF='header/log exposure evidence URL or ticket' \
pnpm verify:final-acceptance
```

本机可用临时 nginx 进程验证同一套静态文件、`/api` 和 `/api/ws` 反代规则；默认监听 `127.0.0.1:3100`，并反代到 `127.0.0.1:3001`。该命令还会通过临时 nginx 入口执行登录、Refresh Cookie、退出登录、管理员接口边界、伪造支付回调负向 smoke，以及 Agent 心跳签名 smoke：

```bash
pnpm build
pnpm smoke:split:nginx
```

验证前端 `/api` 代理、登录、Refresh Cookie、退出登录和管理员接口边界：

```bash
SMOKE_FRONTEND_URL=https://panel.example.com \
SMOKE_BACKEND_URL=http://10.0.0.12:3001 \
SMOKE_ADMIN_USERNAME=admin \
SMOKE_ADMIN_PASSWORD='your-admin-password' \
pnpm smoke:split:auth
```

### 一键安装脚本

`scripts/install-panel.sh` 是产物包安装脚本，会安装 Node.js、PostgreSQL、Redis，创建 `.env`、执行迁移，并生成 systemd 服务。脚本生成的后端配置默认使用 `SERVE_STATIC_CLIENT=false`；配置 Nginx 时会由 Nginx 托管 `client/dist`，并只把 `/api/` 和 `/api/ws/` 反代到后端。

## 开发教程

### 本地依赖

- Node.js 20 或更高版本
- pnpm 9.14.2
- PostgreSQL
- Redis
- Go 1.22 或更高版本，仅开发 Agent 时需要

启用 pnpm：

```bash
corepack enable
corepack prepare pnpm@9.14.2 --activate
pnpm install
```

配置本地环境变量后执行数据库迁移：

```bash
pnpm --filter server exec prisma migrate deploy
```

启动前后端开发服务：

```bash
pnpm dev
```

默认开发端口：

```text
client: http://127.0.0.1:3000
server: http://127.0.0.1:3001
```

本地开发默认也是前后端分离：浏览器访问前端 `http://127.0.0.1:3000`，前端开发服务器把 `/api` 代理到后端 `http://127.0.0.1:3001`。如需继续使用兼容命令，可执行：

```bash
pnpm dev:split
```

该命令与 `pnpm dev` 使用同一套本地分离端口。若要临时改端口，可设置 `VITE_DEV_PORT`、`VITE_DEV_PROXY_TARGET`、`HOST` 和 `PORT` 环境变量。

### 常用命令

```bash
pnpm --filter client type-check
pnpm --filter server type-check
pnpm build
pnpm lint
```

本地检查：

```shell
# Windows
.\scripts\local-ci.ps1
# macOS
.\scripts\local-ci-macos.sh
```

### 数据库开发

Prisma schema 位于 `server/prisma/schema.prisma`，迁移文件位于 `server/prisma/migrations/`。修改数据库结构后，应生成迁移并确认前后端类型检查通过。

常用命令：

```bash
pnpm --filter server exec prisma generate
pnpm --filter server exec prisma migrate dev
pnpm --filter server exec prisma migrate deploy
```

### Agent 开发与发布

Agent 位于 `agent/`，版本号统一由 `agent/VERSION` 控制。

本地测试：

```bash
cd agent
go test ./...
go run ./cmd/incudal-agent -config ./config.example.yaml -once
```

本地构建双架构产物：

```bash
bash agent/scripts/build-release.sh
```

`agent/dist` 只是本地临时构建目录，不提交到 Git。正式发布由 GitHub Actions `Agent Build & Release` 完成：当 `agent/VERSION` 变动并推送后，会发布 GitHub Release，并生成：

```text
incudal-agent-x86_64-v0.0.1
incudal-agent-aarch64-v0.0.1
```

生产安装命令默认从面板 `/api/agent/manifest.json` 和 `/api/agent/binary/*` 获取 Agent 二进制。如果需要临时使用自定义 `INCUDAL_AGENT_BINARY_URL`，URL 必须是 HTTP(S)，并且必须同时提供 64 位十六进制 `INCUDAL_AGENT_BINARY_SHA256`，安装脚本会在替换二进制前校验 checksum。

## 开发约定

- 前端新增文案需要同步维护 `client/src/locales/` 下的多语言键。
- 后端新增管理接口应使用登录鉴权和管理员鉴权，并补充必要的字段校验和速率限制。
- 数据库变更需要提交 Prisma migration，不直接修改生产库结构。
- 不提交构建产物、临时文件、密钥、数据库 dump 或本地 `.env`。
