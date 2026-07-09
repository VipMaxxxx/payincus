---
title: systemd 服务
description: 配置 PayIncus 后端、在线更新与回滚服务
---

# systemd 服务

<p class="doc-lead">使用 systemd 管理长期运行的后端服务，以及按任务 ID 启动的 OTA 更新和回滚 oneshot。</p>

<div class="doc-meta">
  <div><span>主服务</span><strong>incudal-backend</strong></div>
  <div><span>运行用户</span><strong>incudal</strong></div>
  <div><span>工作目录</span><strong>/opt/incudal/current</strong></div>
</div>

::: tip 配置来源
优先复制仓库中的受控模板，不要手工拼接 unit。修改后使用 `systemctl daemon-reload` 并检查服务状态。
:::

## 后端服务

模板文件：

```text
deploy/incudal-backend.service.example
```

安装：

```bash
sudo cp deploy/incudal-backend.service.example /etc/systemd/system/incudal-backend.service
sudo systemctl daemon-reload
sudo systemctl enable --now incudal-backend
sudo systemctl status incudal-backend --no-pager
```

模板的关键运行参数：

```text
User=incudal
Group=incudal
WorkingDirectory=/opt/incudal/current
EnvironmentFile=/opt/incudal/.env
ExecStartPre=/usr/bin/bash -lc 'cd /opt/incudal/current/server && pnpm exec prisma migrate deploy'
ExecStart=/usr/bin/node /opt/incudal/current/server/dist/app.js
```

`WorkingDirectory` 指向 `/opt/incudal/current`，这样 OTA 切换 symlink 后重启服务即可进入新 release。

## 权限边界

后端服务使用 `ProtectSystem=strict` 和 `ProtectHome=true`，只允许写入 PayIncus 运行目录：

```text
/opt/incudal
/opt/incudal/current
/opt/incudal/releases
/opt/incudal/update-logs
/opt/incudal/plugins
/opt/incudal/plugin-data
/opt/incudal/plugin-logs
/opt/incudal/plugin-staging
/opt/incudal/themes
/opt/incudal/theme-data
/opt/incudal/theme-staging
```

不要把 `/`、`/etc` 或数据库目录加入 `ReadWritePaths`。支付密钥、数据库地址、OAuth secret、SMTP 密码和安装 token 只应放在 `/opt/incudal/.env` 或后台加密配置里。

## 在线更新服务

模板文件：

```text
deploy/incudal-online-update@.service.example
deploy/incudal-online-rollback@.service.example
```

安装：

```bash
sudo cp deploy/incudal-online-update@.service.example /etc/systemd/system/incudal-online-update@.service
sudo cp deploy/incudal-online-rollback@.service.example /etc/systemd/system/incudal-online-rollback@.service
sudo systemctl daemon-reload
```

后台 OTA 会为每个更新任务创建任务 ID，然后通过受限 sudoers 启动：

```text
systemctl start --no-block incudal-online-update@<taskId>.service
systemctl start --no-block incudal-online-rollback@<taskId>.service
```

## 受限 sudoers

```bash
printf 'Defaults:incudal !requiretty\nincudal ALL=(root) NOPASSWD: /usr/bin/systemctl start --no-block incudal-online-update@*.service, /usr/bin/systemctl start --no-block incudal-online-rollback@*.service\n' \
  | sudo tee /etc/sudoers.d/incudal-online-update >/dev/null
sudo chmod 440 /etc/sudoers.d/incudal-online-update
sudo visudo -cf /etc/sudoers.d/incudal-online-update
```

这条规则只允许 `incudal` 服务用户启动在线更新和回滚 oneshot，不允许任意 root shell。

## 日志

```bash
sudo journalctl -u incudal-backend -n 200 --no-pager
sudo journalctl -u 'incudal-online-update@*' -n 200 --no-pager
sudo journalctl -u 'incudal-online-rollback@*' -n 200 --no-pager
```

后台 OTA 任务日志还会写入 `SYSTEM_UPDATE_LOG_DIR`，默认是 `/opt/incudal/update-logs`。

## Agent 服务

宿主机 Agent 由后台生成的 Agent 安装命令写入 `incudal-agent.service`。当前模板会限制 Agent 自身资源和 journal 写入速率：

```text
CPUQuota=20%
MemoryMax=256M
TasksMax=128
StandardOutput=journal
StandardError=journal
LogRateLimitIntervalSec=30s
LogRateLimitBurst=120
```

如果宿主机曾经安装过旧 Agent，需要在面板更新后重新复制后台 Agent 安装命令并在宿主机执行一次。只靠 Agent 二进制自升级不会自动改写旧 systemd service，因此旧节点可能仍缺少 CPU、内存和日志速率限制。

## 验证

```bash
systemctl is-active incudal-backend
curl -fsS http://127.0.0.1:3001/api/health
```

如果服务启动失败，先看 `journalctl -u incudal-backend`，再检查 `/opt/incudal/.env`、数据库连接、`/opt/incudal/current` symlink 和 `server/dist/app.js` 是否存在。
