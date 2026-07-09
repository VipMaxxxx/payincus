---
title: 手动部署
description: 将 PayIncus 接入既有数据库、反向代理和发布体系
---

# 手动部署

<p class="doc-lead">将经过 SHA256 校验的 Release 接入已有 PostgreSQL、Nginx、systemd、证书和发布流程，并建立与后台 OTA 一致的原子目录布局。</p>

<div class="doc-meta">
  <div><span>适用场景</span><strong>既有生产基础设施</strong></div>
  <div><span>发布布局</span><strong>current / releases</strong></div>
  <div><span>校验要求</span><strong>Release SHA256</strong></div>
</div>

::: warning 变更窗口
数据库迁移、`current` 切换和 systemd 启动应在受控变更窗口执行。先完成 PostgreSQL 与安装目录备份。
:::

示例环境：

```text
安装目录：/opt/incudal
用户端域名：https://panel.example.com
后台域名：https://admin.example.com
后端地址：127.0.0.1:3001
```

## 运行依赖

服务器需要 Node.js 22、pnpm 9.14.2、PostgreSQL 16、Redis、Nginx 和 systemd。Redis 建议使用 7；实际最低版本应以生产验收脚本为准。

```bash
corepack enable
corepack prepare pnpm@9.14.2 --activate
node -v
pnpm -v
```

## 创建目录和用户

```bash
sudo useradd --system --home /opt/incudal --shell /usr/sbin/nologin incudal 2>/dev/null || true
sudo install -d -o incudal -g incudal /opt/incudal /opt/incudal/releases /opt/incudal/update-logs
sudo install -d -o incudal -g incudal /opt/incudal/plugins /opt/incudal/plugin-data /opt/incudal/plugin-logs /opt/incudal/plugin-staging
sudo install -d -o incudal -g incudal /opt/incudal/themes /opt/incudal/theme-data /opt/incudal/theme-staging
```

不要预先创建普通目录 `/opt/incudal/current`；它必须是指向当前 release 的软链接。

## 下载并校验 Release

先在 [GitHub Releases](https://github.com/VipMaxxxx/payincus/releases) 确认版本和服务器架构。以下版本号仅为示例，请替换为准备部署的正式 Tag。

```bash
export VERSION=v1.3.4
export ARCH=amd64
export PACKAGE="incudal-${VERSION}-linux-${ARCH}.tar.gz"
export RELEASE_DIR="/opt/incudal/releases/${VERSION}"

curl -fLO "https://github.com/VipMaxxxx/payincus/releases/download/${VERSION}/${PACKAGE}"
curl -fLO "https://github.com/VipMaxxxx/payincus/releases/download/${VERSION}/${PACKAGE}.sha256"
sha256sum -c "${PACKAGE}.sha256"
```

校验不通过时立即停止，不要解压或启动服务。

## 安装 Release 并切换 `current`

```bash
sudo install -d -o incudal -g incudal "${RELEASE_DIR}"
sudo tar -xzf "${PACKAGE}" -C "${RELEASE_DIR}"
sudo chown -R incudal:incudal "${RELEASE_DIR}"

sudo rm -f /opt/incudal/releases/.next-current
sudo ln -s "${RELEASE_DIR}" /opt/incudal/releases/.next-current
sudo mv -Tf /opt/incudal/releases/.next-current /opt/incudal/current
readlink -f /opt/incudal/current
test -f /opt/incudal/current/server/dist/app.js
```

Release 产物已经包含构建后的用户端、管理端、后端和生产依赖，不需要在服务器重新执行 `pnpm install` 或 `pnpm build`。自定义源码构建应走独立 CI，生成相同结构并附带可信 SHA256 后再部署。

## 环境变量

```bash
sudo cp /opt/incudal/current/.env.example /opt/incudal/.env
sudo chown incudal:incudal /opt/incudal/.env
sudo chmod 600 /opt/incudal/.env
sudo editor /opt/incudal/.env
```

按 [环境变量](/deployment/environment) 配置生产值，最低必须包含：

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3001
TRUST_PROXY=true
SERVE_STATIC_CLIENT=false

DATABASE_URL=postgresql://incudal:change_me@127.0.0.1:5432/incudal
JWT_SECRET=change_me_generate_with_openssl_rand_base64_48
COOKIE_SECRET=change_me_generate_with_openssl_rand_base64_48
ENCRYPTION_KEY=change_me_generate_with_openssl_rand_base64_48

FRONTEND_URL=https://panel.example.com
ADMIN_FRONTEND_URL=https://admin.example.com
SITE_URL=https://panel.example.com
PAYMENT_CALLBACK_BASE_URL=https://panel.example.com
```

生产不要设置 `RESET_DATABASE`。支付、SMTP、Telegram、Turnstile、对象存储、扩展市场、主题市场和 OTA 变量按实际业务逐项开启。

## 数据库迁移

先备份 PostgreSQL，再执行：

```bash
sudo -u incudal env HOME=/opt/incudal bash -lc \
  'cd /opt/incudal/current/server && pnpm exec prisma migrate deploy'
```

不要在生产使用开发 reset 命令。

## 安装 systemd 和 Nginx

安装并验证 [systemd 服务](/deployment/systemd)，服务工作目录必须是 `/opt/incudal/current`，环境变量从 `/opt/incudal/.env` 读取。

用户端和后台必须使用不同域名和静态目录：

```text
panel.example.com -> /opt/incudal/current/client/dist/user
admin.example.com -> /opt/incudal/current/client/dist/admin
```

`/api/` 和 `/api/ws/` 反代到后端。模板见 [Nginx 分离部署](/deployment/nginx)。

## 验证

```bash
systemctl is-active incudal-backend
curl -fsS http://127.0.0.1:3001/api/health

cd /opt/incudal/current
FRONTEND_URL=https://panel.example.com \
ADMIN_FRONTEND_URL=https://admin.example.com \
BACKEND_URL=http://127.0.0.1:3001 \
pnpm verify:split:host
```

最终生产验收还需要真实支付、Incus/Agent、SMTP/通知、Turnstile、备份恢复和响应头证据，详见 [生产验收](/deployment/production-checklist)。
