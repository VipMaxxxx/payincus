---
title: 一键安装
description: 使用经过校验的 GitHub Release 在 Debian 或 Ubuntu 上部署 PayIncus
---

# 一键安装

<p class="doc-lead">使用官方安装脚本在新服务器上部署 PayIncus。脚本负责依赖、数据库、环境变量、systemd 和外部访问入口。</p>

<div class="doc-meta">
  <div><span>适用场景</span><strong>首次生产部署</strong></div>
  <div><span>支持系统</span><strong>Debian / Ubuntu</strong></div>
  <div><span>默认目录</span><strong>/opt/incudal</strong></div>
</div>

::: tip 完成结果
安装完成后会得到独立的用户端、管理端和本机后端服务。Release 产物必须通过 SHA256 校验后才会解压。
:::

## 前置要求

所有模式都需要一台干净的 Debian / Ubuntu 服务器和 root 或 sudo 权限。外部访问条件取决于安装时选择的模式：

| 模式 | 域名和网络要求 |
| --- | --- |
| Nginx + Certbot | 准备用户端和管理后台两个域名，A/AAAA 指向服务器，并开放公网 80/443。 |
| Cloudflare Tunnel | 两个域名由 Cloudflare 管理，准备 Tunnel 凭证；服务器不需要开放公网入站 80/443。 |
| 仅启动服务 | 不要求脚本配置域名或 TLS；后端默认监听本机端口，由现有反向代理或内网入口接管。 |

默认安装目录是 `/opt/incudal`。这是当前安装脚本、systemd、OTA 和生产 release 布局使用的真实路径。

## 安装命令

```bash
curl -fsSL https://raw.githubusercontent.com/VipMaxxxx/payincus/main/scripts/install-panel.sh -o install-panel.sh
sudo bash install-panel.sh
```

安装过程中按提示输入：

- 用户端域名。
- 管理后台域名。
- 初始管理员邮箱，留空默认 `admin@payincus.local`。
- 初始管理员密码，生产必须使用强密码。

## 脚本会做什么

- 安装 Node.js、pnpm、PostgreSQL、Redis、Nginx 和 systemd 依赖。
- 创建数据库连接和 `/opt/incudal/.env`。
- 下载最新 GitHub Release artifact 及其 `.sha256`，校验通过后才解压。
- 解压 PayIncus 到 `/opt/incudal`。
- 执行 Prisma migration 和 Prisma Client 生成。
- 创建 `incudal` 系统用户和 `incudal-backend` 服务。
- 创建 OTA、证书、缓存和日志目录。
- 写入用户端和管理端 Nginx 配置。
- 设置 `FRONTEND_URL`、`ADMIN_FRONTEND_URL`、`SITE_URL` 和 `PAYMENT_CALLBACK_BASE_URL`。

## 升级和卸载

```bash
sudo bash install-panel.sh --upgrade
sudo bash install-panel.sh --uninstall
```

`--upgrade` 只用于旧版非原子目录。检测到 `/opt/incudal/current` 原子布局时，脚本会安全退出，请改用管理后台 OTA，避免覆盖 `current/releases`。

旧版升级会保留 `.env`、证书、运行缓存和 OTA 目录。卸载会删除整个 `/opt/incudal`，包括运行资产、OTA release 和更新日志；PostgreSQL/Redis 服务及数据库不会自动删除。卸载前先完成数据库和安装目录备份。

## 安装后检查

```bash
systemctl status incudal-backend --no-pager
journalctl -u incudal-backend -n 100 --no-pager
```

访问：

```text
https://panel.example.com
https://admin.example.com
```

执行生产 split 验证：

```bash
cd /opt/incudal/current 2>/dev/null || cd /opt/incudal
FRONTEND_URL=https://panel.example.com \
ADMIN_FRONTEND_URL=https://admin.example.com \
BACKEND_URL=http://127.0.0.1:3001 \
pnpm verify:split:host
```

如果你启用了原子 OTA 布局，当前运行目录是 `/opt/incudal/current`；旧布局则是 `/opt/incudal`。
