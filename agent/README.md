# Incudal Host Agent

宿主机 Agent 客户端实现。

当前阶段负责读取配置、向面板上报 HMAC 签名心跳，并按面板心跳响应执行自动升级。

## 配置

默认配置路径：

```bash
/etc/incudal-agent/config.yaml
```

示例：

```yaml
panel_url: "https://idev.bitpd.com"
agent_id: "agt_xxx"
agent_secret: "ias_xxx"
heartbeat_interval_seconds: 30
request_timeout_seconds: 10
```

也可以使用环境变量覆盖：

```bash
INCUDAL_PANEL_URL=
INCUDAL_AGENT_ID=
INCUDAL_AGENT_SECRET=
INCUDAL_HEARTBEAT_INTERVAL_SECONDS=
INCUDAL_REQUEST_TIMEOUT_SECONDS=
```

## 运行

单次心跳测试：

```bash
go run ./cmd/incudal-agent -config ./config.example.yaml -once
```

循环心跳：

```bash
go run ./cmd/incudal-agent -config /etc/incudal-agent/config.yaml
```

## 当前能力

- 读取 Agent 配置
- 采集 CPU 数量和内存总量
- 探测常见 Incus/LXD Unix socket
- 生成 canonical JSON body hash
- 生成 HMAC-SHA256 签名
- 调用 `POST /api/agent/heartbeat`
- 读取心跳响应中的 `upgrade` 指令并自动升级自身

当前不执行实例创建、销毁、启停等下发任务。

## 自动升级

面板会在 Agent 心跳响应中返回升级指令：

```json
{
  "upgrade": {
    "available": true,
    "version": "v1.0.1",
    "url": "https://<panel>/api/agent/binary/incudal-agent-linux-amd64?v=v1.0.1",
    "sha256": "<sha256>",
    "gzip": false
  }
}
```

Agent 只接受当前 `panel_url` 同源下载地址。下载后先校验 SHA-256，再解包、写入临时文件、备份旧二进制、原子替换并执行 `systemctl restart incudal-agent`。

`-once` 单次心跳测试模式不会执行自动升级，避免安装前置检测阶段替换正在测试的二进制。

旧版本 Agent 不包含升级执行器，首次启用自动升级时仍需要通过面板安装命令或重新安装按钮部署一次新版 Agent；之后才会按心跳响应自动升级。

## Release 构建与发布

本地构建双架构二进制：

```bash
cd ..
bash agent/scripts/build-release.sh
```

Agent 版本统一从 `agent/VERSION` 读取，格式固定为 `vMAJOR.MINOR.PATCH`。
需要发布新版 Agent 时，先递增 `agent/VERSION`，再构建 release 产物。

产物：

```text
agent/dist/incudal-agent-linux-amd64
agent/dist/incudal-agent-linux-arm64
agent/dist/manifest.json
```

`agent/dist` 是本地临时构建目录，不再纳入 Git。正式发布由 GitHub Actions `Agent Build & Release` 完成。

推送中只要 `agent/VERSION` 发生变化，Actions 会读取该版本号，构建并发布 GitHub Release：

```text
tag: agent-v0.0.1
assets:
  incudal-agent-x86_64-v0.0.1
  incudal-agent-aarch64-v0.0.1
```

面板运行时不会读取本地 `agent/dist`。它会从 GitHub Release 查询最新 Agent 版本，动态生成 `/api/agent/manifest.json`，并通过 `/api/agent/binary/*` 代理下载对应 Release 资产。

默认 GitHub Release 仓库为 `VipMaxxxx/incudal`。如果部署到 fork 或私有仓库，可设置：

```bash
INCUDAL_AGENT_RELEASE_REPOSITORY="owner/repo"
INCUDAL_AGENT_RELEASE_TOKEN="github_pat_xxx" # 私有仓库需要
```

## 安装脚本

面板提供通用安装脚本：

```bash
curl -fsSL "$PANEL_URL/api/agent/install.sh" | sudo env \
  INCUDAL_PANEL_URL="$PANEL_URL" \
  INCUDAL_AGENT_INSTALL_TOKEN="$AGENT_INSTALL_TOKEN" \
  INCUDAL_AGENT_BINARY_URL="$BINARY_URL" \
  bash
```

`INCUDAL_AGENT_INSTALL_TOKEN` 由面板生成，30 分钟内有效且只能使用一次。
安装脚本会调用 `/api/agent/install-config/:token` 拉取 `agent_id` 和 `agent_secret`。
旧的 `INCUDAL_AGENT_ID` / `INCUDAL_AGENT_SECRET` 直传方式仍保留兼容。

安装脚本会：

- 下载 `incudal-agent` 二进制
- 写入 `/etc/incudal-agent/config.yaml`
- 写入 systemd service
- 执行一次心跳测试
- 启动或重启 `incudal-agent.service`

如果没有传入 `INCUDAL_AGENT_BINARY_URL`，默认从当前面板下载：

```text
https://<panel>/api/agent/binary/incudal-agent-linux-amd64
https://<panel>/api/agent/binary/incudal-agent-linux-arm64
```

默认下载会先读取面板的 manifest：

```text
https://<panel>/api/agent/manifest.json
```

安装脚本会按当前 OS/ARCH 取出文件名和 SHA-256，下载后先校验摘要，再解包安装。

如果手动传入 `INCUDAL_AGENT_BINARY_URL`，必须同时传入 `INCUDAL_AGENT_BINARY_SHA256`。安装脚本会先校验 SHA-256，缺少或不匹配时会直接失败，不会安装自定义二进制。

安装脚本会先下载到临时文件，再原子替换 `/usr/local/bin/incudal-agent`。
重复安装或升级时，会执行 `systemctl restart incudal-agent` 确保立即切换到最新二进制。

dry-run 验证：

```bash
INCUDAL_AGENT_DRY_RUN=1 \
INCUDAL_PANEL_URL="http://127.0.0.1:3001" \
INCUDAL_AGENT_INSTALL_TOKEN="ait_testtoken_abcdefghijklmnopqrstuvwxyz123456" \
bash server/templates/agent-install.sh
```
