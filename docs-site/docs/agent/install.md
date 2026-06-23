# Agent 安装

Agent 运行在 Incus 宿主机上，用于上报宿主机资源、实例状态、流量数据，并配合面板完成交付链路。

## 发布配置

```dotenv
INCUDAL_AGENT_RELEASE_REPOSITORY=VipMaxxxx/payincus
INCUDAL_AGENT_RELEASE_TOKEN=
```

如果暂时没有 GitHub Agent Release，也可以使用本地 release 目录：

```dotenv
INCUDAL_AGENT_RELEASE_DIR=/opt/incudal/agent-release
```

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
