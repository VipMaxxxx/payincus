<h1 align="center"><img src="./client/public/incudal_logo.webp" width="96" align="absmiddle" alt="PayIncus logo"> PayIncus</h1>

<p align="center">基于 Incus 的 LXC / KVM NAT VPS 销售、交付与管理面板。</p>

<p align="center">
  <a href="https://demo.payincus.com">测试用户端</a>
  ·
  <a href="https://demoadmin.payincus.com">测试后台</a>
  ·
  <a href="https://docs.payincus.com">文档站</a>
  ·
  <a href="https://t.me/Payincus">Telegram 交流群</a>
  ·
  <a href="https://github.com/VipMaxxxx/payincus">GitHub</a>
</p>

## 项目说明

PayIncus 是基于开源项目 [qwer-xyz/incudal](https://github.com/qwer-xyz/incudal) 进行二次开发的 Incus 面板，面向 NAT VPS、LXC / KVM 实例、套餐销售、账务计费、用户后台、管理员后台和宿主机 Agent 管理场景。

当前维护重点是非 Docker 生产部署、前后端分离、安全审计、支付回调、资源交付和 Agent 上报链路。

访问入口：

- 测试用户端：https://demo.payincus.com
- 测试后台：https://demoadmin.payincus.com
- 文档站：https://docs.payincus.com
- Telegram 交流群：https://t.me/Payincus
- 当前仓库：https://github.com/VipMaxxxx/payincus
- 原始项目：https://github.com/qwer-xyz/incudal

## 核心能力

- 实例交付：基于 Incus 创建和管理 LXC / KVM 实例，支持 NAT 网络、IPv6、系统镜像、套餐资源和节点绑定。
- 用户后台：注册登录、控制台、实例详情、终端 WebSocket、工单、公告、通知、邀请、钱包、邮箱和托管节点。
- 管理后台：用户、套餐、节点、镜像、订单、日志、OAuth、Telegram、邮件、系统配置、资源池和统计。
- 计费账务：余额、充值、支付回调、消费记录、返利、积分、VIP 等级和会员福利。
- 宿主机 Agent：安装脚本、心跳、资源上报、实例报告、流量统计和二进制下载代理。
- 生产安全：JWT、Cookie、CORS、CSP、Helmet、SSRF 防护、文件上传校验、支付签名/IP 白名单和敏感日志脱敏。
- 后台 OTA：管理后台查看当前版本、更新内容、Release OTA 包、SHA256、任务日志和回滚入口；生产支持 `current`/`releases` 原子切换、失败自动回滚和手动回滚。

## 技术栈

```text
client/                 Vue 3 + Vite 前端
server/                 Fastify + Prisma 后端
agent/                  Go 宿主机 Agent
server/prisma/          Prisma schema 与 migrations
server/templates/       Agent / 节点安装模板
deploy/                 systemd 与 Nginx 分离部署模板
scripts/                安装、构建、预检和 smoke 脚本
```

运行依赖：

- Node.js 20+，生产推荐 Node.js 22
- pnpm 9.14.2
- PostgreSQL，生产推荐 PostgreSQL 16
- Redis 7
- Nginx + systemd
- Go 1.22+，仅开发或构建 Agent 时需要

## 推荐生产架构

生产环境推荐非 Docker、前后台双前端分离部署。当前代码不是一个前端入口里区分用户/后台，而是两个 Vite entry、两个构建目录、两个公网域名，共用同一个后端 API：

```text
用户浏览器
  -> https://demo.payincus.com
  -> Nginx 静态用户端：/opt/incudal/client/dist/user
  -> /api 和 /api/ws 反代到后端 127.0.0.1:3001 或内网 IP:3001

管理员浏览器
  -> https://demoadmin.payincus.com
  -> Nginx 静态管理端：/opt/incudal/client/dist/admin
  -> /api 和 /api/ws 反代到同一个后端 127.0.0.1:3001 或内网 IP:3001

后端 Node API
  -> PostgreSQL / Redis / Incus 节点 / Agent
```

双机内网部署可以写成：

```text
https://demo.payincus.com
  -> 用户端 Nginx
  -> /api, /api/ws -> http://10.0.0.12:3001

https://demoadmin.payincus.com
  -> 管理端 Nginx
  -> /api, /api/ws -> http://10.0.0.12:3001

http://10.0.0.12:3001
  -> 后端 Node API
  -> PostgreSQL / Redis / Incus 节点 / Agent
```

约定：

- 用户端和管理端必须使用两个独立公网域名：用户端 `FRONTEND_URL`，管理端 `ADMIN_FRONTEND_URL`。
- 用户端构建入口是 `VITE_APP_ENTRY=user`，产物目录是 `client/dist/user`。
- 管理端构建入口是 `VITE_APP_ENTRY=admin`，产物目录是 `client/dist/admin`。
- 两个前端都使用 `VITE_API_BASE_URL=/api`，浏览器只访问同源 `/api` 和 `/api/ws`。
- 后端监听 `127.0.0.1:3001` 或内网 IP，生产必须设置 `SERVE_STATIC_CLIENT=false`，不由后端直接托管前端静态文件。
- Nginx 分别托管 `client/dist/user` 和 `client/dist/admin`，并且只把两个站点的 `/api/` 和 `/api/ws/` 反代到后端。
- 支付回调地址使用客户面板公网域名，不使用后端内网地址或管理后台域名。
- 用户端不能暴露后台入口、后台 API 或后台跳转；管理端不能暴露用户端自助功能入口。

## 一键安装

`scripts/install-panel.sh` 是生产安装脚本，会安装 Node.js、PostgreSQL、Redis，创建 `.env`，执行 Prisma migration，生成 systemd 服务，并配置 Nginx。

```bash
curl -fsSL https://raw.githubusercontent.com/VipMaxxxx/payincus/main/scripts/install-panel.sh -o install-panel.sh
sudo bash install-panel.sh
```

升级：

```bash
sudo bash install-panel.sh --upgrade
```

卸载：

```bash
sudo bash install-panel.sh --uninstall
```

安装脚本从当前仓库 Release 下载预构建产物包：

```text
https://github.com/VipMaxxxx/payincus/releases
```

## 手动部署

手动部署也按双前端分离方式执行。以下示例假设安装目录是 `/opt/incudal`，用户端域名是 `demo.payincus.com`，后台域名是 `demoadmin.payincus.com`。

安装依赖：

```bash
corepack enable
corepack prepare pnpm@9.14.2 --activate
pnpm install --frozen-lockfile
```

生成 Prisma Client、执行迁移并构建用户端、管理端和后端：

```bash
pnpm --filter server exec prisma generate
pnpm --filter server exec prisma migrate deploy
VITE_API_BASE_URL=/api \
VITE_CUSTOMER_BASE_URL=https://demo.payincus.com \
VITE_ADMIN_BASE_URL=https://demoadmin.payincus.com \
pnpm build
```

构建完成后关键产物应存在：

```text
client/dist/user/index.html
client/dist/admin/index.html
server/dist/app.js
```

后端生产启动示例：

```bash
NODE_ENV=production \
HOST=127.0.0.1 \
PORT=3001 \
SERVE_STATIC_CLIENT=false \
FRONTEND_URL=https://demo.payincus.com \
ADMIN_FRONTEND_URL=https://demoadmin.payincus.com \
SITE_URL=https://demo.payincus.com \
PAYMENT_CALLBACK_BASE_URL=https://demo.payincus.com \
node server/dist/app.js
```

同机部署的最小启动命令也可以写成：

```bash
NODE_ENV=production HOST=127.0.0.1 PORT=3001 SERVE_STATIC_CLIENT=false node server/dist/app.js
```

systemd 模板：

```bash
sudo cp deploy/incudal-backend.service.example /etc/systemd/system/incudal-backend.service
sudo systemctl daemon-reload
sudo systemctl enable --now incudal-backend
sudo journalctl -u incudal-backend -f
```

Nginx 模板：

```text
deploy/nginx-split-intranet.conf.example
```

需要替换：

- `demo.payincus.com`：你的客户面板公网域名
- `demoadmin.payincus.com`：你的管理后台公网域名
- `/opt/incudal/client/dist/user`：客户前端构建产物目录
- `/opt/incudal/client/dist/admin`：后台前端构建产物目录
- `10.0.0.12:3001`：后端内网 IP 和端口

部署后应验证：

```bash
FRONTEND_URL=https://demo.payincus.com \
ADMIN_FRONTEND_URL=https://demoadmin.payincus.com \
BACKEND_URL=http://127.0.0.1:3001 \
pnpm verify:split:host
```

## 后台在线更新

管理后台提供“版本更新”页面，用于查看当前版本、Git tag、commit、构建/部署时间、更新内容、可更新版本、更新任务日志和回滚入口。

在线更新的设计边界：

- 只在管理后台暴露，用户端不包含更新入口和更新 API。
- 接口路径固定为 `/api/admin/system-update/*`。
- 只有超级管理员可以检查、启动更新和回滚。默认允许用户名为 `admin` 的管理员；生产建议显式配置 `SYSTEM_UPDATE_ALLOWED_ADMIN_IDS`。
- 更新目标必须是形如 `v1.2.3` 的 release tag。
- 生产目录必须包含 `.git` 和 release tags。`scripts/install-panel.sh` 会在解压 release 包后初始化 Git 元数据并同步 tags；如果你手动纯 tar 解压且没有初始化 Git，后台只能显示当前版本，不能执行在线更新。
- 后台服务只负责创建任务；生产环境默认通过受限 sudo 启动 `incudal-online-update@.service` 或 `incudal-online-rollback@.service`，实际更新/回滚由 root 级 systemd oneshot 执行。
- 检查更新时会读取 GitHub Release OTA manifest，后台展示发行包、架构、大小和 SHA256。
- 默认 `SYSTEM_UPDATE_APPLY_MODE=auto`：如果目标 tag 有匹配当前 Linux 架构的 OTA artifact，更新任务会下载 release tar.gz、校验 SHA256、解压并替换安装内容；没有可用 artifact 时回退到 Git tag 兼容构建模式。也可设置为 `artifact` 强制只允许 OTA 包，或设置为 `git` 强制走旧的 Git 构建路径。
- Artifact 模式会校验 release 包完整性并应用预构建产物：旧布局会先备份当前目录，原子 OTA 布局会创建新的 release 目录并切换 `current`。两种布局都会执行 Prisma migration、split host 验证、生产预检和响应头/日志检查。前后台边界守卫在 GitHub Release 打包前执行。
- Git 兼容模式会先备份当前目录，再执行 `git checkout --force <tag>`、依赖安装、构建、Prisma migration、前后台边界守卫、split host 验证、生产预检、响应头/日志检查和 Agent release smoke。
- 如果更新已创建备份但后续应用、重启或验证失败，worker 会尝试自动回滚到备份版本，并把失败现场保存在 `/opt/incudal.failed-update.<timestamp>` 便于排查。
- 可执行 `bash scripts/migrate-ota-atomic-layout.sh` 将部署迁移为原子 OTA 布局：`/opt/incudal/current` 指向当前 release，`/opt/incudal/releases/<version>` 保存各版本，systemd 运行 `current` 指针。迁移后 artifact 更新会先解压到新的 release 目录，再切换 `current`；失败回滚只需切回上一版 release。
- 原子 OTA 布局下，成功更新会把上一版 release 路径记录到任务 `backupPath`；管理后台回滚会把 `current` 切回该路径，重启后端，并重新执行 split host 验证。
- 更新期间会保留 `.env`、`server/certs`、`agent-release`、`.npm` 和 `.cache` 等运行态资产。

推荐生产环境变量：

```env
SYSTEM_UPDATE_ALLOWED_ADMIN_IDS=1
SYSTEM_UPDATE_LOG_DIR=/opt/incudal/update-logs
SYSTEM_UPDATE_STARTED_BY_USER_ID=1
SYSTEM_UPDATE_RELEASE_REPOSITORY=VipMaxxxx/payincus
SYSTEM_UPDATE_APPLY_MODE=auto
# 私有仓库或 API 限流时配置，public release 可留空
SYSTEM_UPDATE_RELEASE_TOKEN=
```

后台页面路径：

```text
https://demoadmin.payincus.com/admin/system-update
```

命令行启动在线更新：

```bash
cd /opt/incudal
pnpm update:online v1.2.3
```

手动部署时还需要安装在线更新 systemd 模板和 sudoers，安装脚本会自动完成；不用安装脚本时可参考：

```bash
sudo cp deploy/incudal-online-update@.service.example /etc/systemd/system/incudal-online-update@.service
sudo cp deploy/incudal-online-rollback@.service.example /etc/systemd/system/incudal-online-rollback@.service
printf 'Defaults:incudal !requiretty\nincudal ALL=(root) NOPASSWD: /usr/bin/systemctl start --no-block incudal-online-update@*.service, /usr/bin/systemctl start --no-block incudal-online-rollback@*.service\n' \
  | sudo tee /etc/sudoers.d/incudal-online-update >/dev/null
sudo chmod 440 /etc/sudoers.d/incudal-online-update
sudo visudo -cf /etc/sudoers.d/incudal-online-update
sudo systemctl daemon-reload
```

如果 systemd 服务名或域名不同，执行时覆盖：

```bash
SERVICE_NAME=incudal-backend \
FRONTEND_URL=https://demo.payincus.com \
ADMIN_FRONTEND_URL=https://demoadmin.payincus.com \
BACKEND_URL=http://127.0.0.1:3001 \
pnpm update:online v1.2.3
```

回滚应优先在管理后台对应任务里操作。回滚会把任务记录里的备份目录恢复回来，并重启后端服务。

## 关键环境变量

生产 `.env` 推荐从 `.env.example` 复制后修改。核心项：

```env
NODE_ENV=production
HOST=127.0.0.1
PORT=3001
TRUST_PROXY=true
SERVE_STATIC_CLIENT=false

DATABASE_URL=postgresql://incudal:change_me@127.0.0.1:5432/incudal
REDIS_URL=redis://:change_me@127.0.0.1:6379

FRONTEND_URL=https://demo.payincus.com
ADMIN_FRONTEND_URL=https://demoadmin.payincus.com
SITE_URL=https://demo.payincus.com
PAYMENT_CALLBACK_BASE_URL=https://demo.payincus.com
VITE_API_BASE_URL=/api
VITE_CUSTOMER_BASE_URL=https://demo.payincus.com
VITE_ADMIN_BASE_URL=https://demoadmin.payincus.com

COOKIE_SAME_SITE=
COOKIE_SECURE=
COOKIE_DOMAIN=

JWT_SECRET=change_me_generate_with_openssl_rand_base64_48
COOKIE_SECRET=change_me_generate_with_openssl_rand_base64_48
ENCRYPTION_KEY=change_me_generate_with_openssl_rand_base64_48
ADMIN_PASSWORD=change_me_admin_password
```

注意：

- 生产环境不要设置 `RESET_DATABASE`。
- 如确实要清空生产库，后端要求同时设置 `ALLOW_PRODUCTION_DATABASE_RESET=RESET_PRODUCTION_DATABASE`，否则启动会拒绝清库。
- `TRUST_PROXY=true` 只应在后端端口仅允许可信 Nginx 或内网代理访问时开启。
- HTTPS 同域 `/api` 反代部署下，Cookie 配置保持空值即可使用自动模式。
- `COOKIE_DOMAIN` 必须保持空值，避免客户面板和管理后台跨子域共享 refresh cookie。
- 内网 HTTP 临时验证且没有 TLS 时，可设置 `COOKIE_SECURE=false`。

## Agent 发布配置

Agent 正式二进制不直接提交到源码仓库。默认建议从当前仓库 GitHub Release 获取：

```env
INCUDAL_AGENT_RELEASE_REPOSITORY=VipMaxxxx/payincus
INCUDAL_AGENT_RELEASE_TOKEN=
```

如果还没有发布 Agent Release，也可以在服务器放置本地 release 目录：

```env
INCUDAL_AGENT_RELEASE_DIR=/opt/incudal/agent-release
```

本地构建 Agent release：

```bash
cd agent
go test ./...
cd ..
bash agent/scripts/build-release.sh
```

`agent/dist` 是本地临时构建目录，不提交到 Git。

## 本地开发

初始化：

```bash
corepack enable
corepack prepare pnpm@9.14.2 --activate
pnpm install
bash scripts/init-env.sh
pnpm --filter server exec prisma migrate deploy
```

启动开发服务：

```bash
pnpm dev
```

默认端口：

```text
前端: http://127.0.0.1:3000
后台: http://127.0.0.1:3002
后端: http://127.0.0.1:3001
```

本地开发同样使用前后端分离：浏览器访问客户前端 `3000` 或后台前端 `3002`，两个 Vite 服务都把 `/api` 代理到后端 `3001`。

## 文档站

文档站源码位于 `docs-site/`，使用 VitePress 构建，面向 `docs.payincus.com`。文档站支持中英双语：中文默认路径 `/`，英文路径 `/en/`。

本地预览：

```bash
pnpm docs:install
pnpm docs:dev
```

如果提示 `vitepress: command not found`，说明文档站依赖还没有安装，先在仓库根目录执行 `pnpm docs:install`。

构建静态站：

```bash
pnpm docs:build
```

主要页面：

- 首页：`docs-site/docs/index.md`
- 英文首页：`docs-site/docs/en/index.md`
- 系统架构：`docs-site/docs/guide/architecture.md`
- 前后台分离：`docs-site/docs/guide/split-deployment.md`
- 后台 OTA：`docs-site/docs/guide/ota-update.md`
- 生产验收：`docs-site/docs/deployment/production-checklist.md`
- 系统版本更新日志：`docs-site/docs/release/version-log.md`、`docs-site/docs/en/release/version-log.md`

## 验证命令

基础检查：

```bash
pnpm lint
pnpm test
pnpm build
cd agent && go test ./...
```

前后端分离检查：

```bash
FRONTEND_URL=https://demo.payincus.com \
ADMIN_FRONTEND_URL=https://demoadmin.payincus.com \
BACKEND_URL=http://127.0.0.1:3001 \
pnpm verify:split:host
```

双机内网后端示例：

```bash
FRONTEND_URL=https://demo.payincus.com \
ADMIN_FRONTEND_URL=https://demoadmin.payincus.com \
BACKEND_URL=http://10.0.0.12:3001 \
pnpm verify:split:host
```

生产预检：

```bash
ENV_FILE=/opt/incudal/.env \
FRONTEND_URL=https://demo.payincus.com \
ADMIN_FRONTEND_URL=https://demoadmin.payincus.com \
BACKEND_URL=http://127.0.0.1:3001 \
pnpm verify:production
```

`pnpm verify:production` 会检查非 Docker 前后端分离部署关键项，包括 `NODE_ENV=production`、`PORT=3001`、`SERVE_STATIC_CLIENT=false`、`VITE_API_BASE_URL=/api`、公网 HTTPS `FRONTEND_URL` / `ADMIN_FRONTEND_URL` / `SITE_URL` / `PAYMENT_CALLBACK_BASE_URL`、`TRUST_PROXY=true`、`PAYMENT_CALLBACK_SKIP_IP_WHITELIST=false`、支付回调 IP 白名单格式，以及 Agent Release 或自定义 Agent 二进制校验配置。默认还会执行数据库配置预检、两个前端站点的 `verify:split:host`，并检查 `/api/agent/manifest.json` 可用性。

如果暂时只想检查 `.env` 静态配置，可跳过数据库和线上 HTTP 检查：

```bash
ENV_FILE=/opt/incudal/.env RUN_LIVE_CHECKS=0 pnpm verify:production
```

本地临时 Nginx 分离 smoke：

```bash
pnpm build
pnpm smoke:split:nginx
```

严格上线验收：

该入口会强制开启生产预检、登录/权限 smoke、Agent release endpoint smoke、生产响应头/日志暴露检查和 `REQUIRE_LIVE_PROOF_REFS=1`。下面的 evidence 占位文字必须替换成真实工单、监控、日志或验收记录引用，否则命令会失败。

```bash
ENV_FILE=/opt/incudal/.env \
FRONTEND_URL=https://demo.payincus.com \
ADMIN_FRONTEND_URL=https://demoadmin.payincus.com \
BACKEND_URL=http://127.0.0.1:3001 \
RUN_SPLIT_AUTH_SMOKE=1 \
RUN_AGENT_RELEASE_SMOKE=1 \
RUN_LOG_HEADER_CHECK=1 \
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

`verify:final-acceptance` 需要真实支付、真实 Incus、真实 Agent、真实邮件/图片/通知和日志响应头证据；没有这些证据时不应视为最终生产验收完成。

## 开发约定

- 默认使用 pnpm，不提交 `package-lock.json`。
- 不提交 `.env`、密钥、数据库 dump、构建产物、`node_modules`、`client/dist`、`server/dist` 或 `agent/dist`。
- 前端新增文案需同步维护 `client/src/locales/`。
- 后端新增管理接口必须有登录鉴权、管理员鉴权、字段校验和必要的速率限制。
- 涉及支付、余额、积分、VIP、实例交付、Agent、文件上传和外部 URL 的改动必须补充负向测试。
- 数据库结构变更必须提交 Prisma migration，不直接手改生产库结构。
