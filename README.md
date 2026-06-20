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
.github/workflows/      CI、Docker、Agent Release 工作流
scripts/                本地开发和检查脚本
```

## 搭建教程

当前无论使用哪种部署方式，都需要在 `server/certs` 目录下生成或放置证书与密钥，并确保 Docker 容器具有读取权限。

### 方式一：Docker Compose 开发环境

适合本地试跑和开发预览。该方式会自动启动 Node、PostgreSQL 和 Redis，并自动安装依赖、执行数据库迁移。

```bash
git clone https://github.com/VipMaxxxx/payincus.git
cd incudal
docker compose -f docker-compose.dev.yml up
```

启动后访问：

```text
前端：http://127.0.0.1:43173
后端：http://127.0.0.1:8888
```

停止服务：

```bash
docker compose -f docker-compose.dev.yml down
```

如需同时删除本地开发数据库卷：

```bash
docker compose -f docker-compose.dev.yml down -v
```

### 方式二：生产镜像部署

生产环境建议准备独立 PostgreSQL 和 Redis，然后构建并运行镜像。

```bash
docker build -t incudal:local .
docker run -d --name incudal \
  -p 3000:3000 \
  --env-file .env \
  incudal:local
```

生产环境至少需要配置：

```env
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://user:password@postgres:5432/incudal
REDIS_URL=redis://redis:6379
JWT_SECRET=please-change-to-a-long-random-secret
FRONTEND_URL=https://your-domain.example
```

容器启动时会执行 `prisma migrate deploy`，然后启动后端服务。生产部署前请确保数据库可连接、`JWT_SECRET` 足够随机、反向代理和 HTTPS 已配置好。

Agent 正式二进制不存放在面板仓库内，面板运行时会从 GitHub Release 查询和代理下载。如部署在私有仓库或 fork，可按需配置：

```env
INCUDAL_AGENT_RELEASE_REPOSITORY=VipMaxxxx/incudal
INCUDAL_AGENT_RELEASE_TOKEN=github_pat_xxx
```

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
client: http://127.0.0.1:5173
server: http://127.0.0.1:8888
```

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

## 开发约定

- 前端新增文案需要同步维护 `client/src/locales/` 下的多语言键。
- 后端新增管理接口应使用登录鉴权和管理员鉴权，并补充必要的字段校验和速率限制。
- 数据库变更需要提交 Prisma migration，不直接修改生产库结构。
- 不提交构建产物、临时文件、密钥、数据库 dump 或本地 `.env`。
