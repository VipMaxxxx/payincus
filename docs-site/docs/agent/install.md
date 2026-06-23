# Agent 安装

Agent 运行在 Incus 宿主机上，用于上报宿主机资源、实例状态、流量数据，并配合面板完成交付链路。

## 宿主机系统

节点安装脚本推荐用于 Ubuntu 22.04+、Debian 12/13。Debian 11 保留兼容安装能力，但不建议作为新节点系统；Debian 10 及更低版本会被安装脚本拒绝。

## 面板证书信任

节点安装脚本会把面板的 Incus 客户端证书导入到宿主机的 Incus trust 列表中，名称为 `panel`。如果面板重装、迁移、灾备恢复或证书重新生成，宿主机可能仍保留旧的 `panel` 证书，后台创建存储池或读取资源时会出现 `not authorized`。

遇到这种情况时，在后台重新生成节点安装命令并在宿主机上重新执行。新脚本会先下载当前面板证书，再替换宿主机上已有的 `panel` 信任项。

## 发布配置

```dotenv
INCUDAL_AGENT_RELEASE_REPOSITORY=VipMaxxxx/payincus
INCUDAL_AGENT_RELEASE_TOKEN=
```

如果暂时没有 GitHub Agent Release，也可以使用本地 release 目录：

```dotenv
INCUDAL_AGENT_RELEASE_DIR=/opt/incudal/agent-release
```

Agent 安装脚本会读取 `https://<panel>/api/agent/manifest.json`，并按当前系统架构选择 `linux-amd64` 或 `linux-arm64` 二进制。如果安装时报 `agent manifest does not contain linux-amd64 binary metadata`，通常表示安装脚本版本过旧，无法解析面板返回的单行 JSON manifest。请先更新面板到包含 Agent manifest 解析修复的版本，再重新复制后台生成的 Agent 安装命令。

如果后台日志显示安装 token 已被消费，但 Agent 仍然离线，并且 Nginx access log 中 `/api/agent/binary/...gz?v=<timestamp>` 返回 HTTP 400，说明旧安装脚本把二进制下载的缓存刷新参数写成了后端保留的 `v` 参数。请更新面板到包含 Agent 二进制下载参数修复的版本，确认公开 `install.sh` 中二进制 URL 使用 `cache_bust` 参数，然后重新复制后台生成的 Agent 安装命令。

## 本地构建

```bash
cd agent
go test ./...
cd ..
bash agent/scripts/build-release.sh
```

## 生产 proof

最终验收需要在真实生产 Incus 宿主机安装 Agent，并确认：

- 心跳上报。
- 资源上报。
- 实例状态上报。
- 流量上报。
- 错误签名和重放请求被拒绝。
